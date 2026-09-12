// 底图工坊 · 从 Release 资产把底图取回本机（v1.5.5）
// ============================================================================
// 为什么要有它：19 张底图合计约 333 MB，长期放在 git 里会让**每一次克隆**都变成几百 MB，
// 用户换机器时"装个插件要拉几百兆"就是这么来的。改成：仓库只留 wallpapers.manifest.json
// （路径 + 字节数 + sha256），图作为 GitHub Release 资产发布，本机按需取回。
//
// **单一实现**：host 半的 `/bga/fetch-wallpapers` 路由与 `tools/fetch-wallpapers.mjs`
// 都调这里的 fetchWallpapers() —— 不存在"界面能下、命令行不能下"这种分叉。
//
// 设计要点：
//  · 逐张校验（字节数 + sha256）后才算成功，**先写临时文件再 rename**：中断不会留下半个文件被当成好图。
//  · 已存在且校验通过的一律跳过 ⇒ 可重入、可断点续传（重跑只补缺的）。
//  · 单张失败不中断其余（收集到 errors 里返回），因为"19 张里差 2 张"比"一张都不下"有用得多。
//  · 并发默认 3 —— 家用宽带下够快，又不会把 GitHub 或自己的磁盘打满。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
export const MANIFEST_FILE = 'wallpapers.manifest.json'

export function readManifest(pluginDir = PLUGIN_DIR) {
  const f = path.join(pluginDir, MANIFEST_FILE)
  const m = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (m.format !== 'dsh-bg-atelier-wallpapers/1' || !Array.isArray(m.items)) throw new Error('清单格式不认识：' + f)
  return m
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** 本机已有且校验通过？返回 { state: 'ok'|'missing'|'bad', bytes } */
export function checkLocal(file, item) {
  try {
    const st = fs.statSync(file)
    if (st.size !== item.bytes) return { state: 'bad', bytes: st.size }
    return { state: sha256(fs.readFileSync(file)) === item.sha256 ? 'ok' : 'bad', bytes: st.size }
  } catch { return { state: 'missing', bytes: 0 } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function downloadOne(url, item, opts) {
  let lastErr = null
  for (let attempt = 0; attempt <= (opts.retries || 2); attempt++) {
    if (attempt) await sleep(400 * attempt * attempt)   // 退避
    try {
      if (typeof fetch !== 'function') throw new Error('本机 Node 没有全局 fetch（需要 Node 18+）')
      const res = await fetch(url, { headers: { 'user-agent': 'dsh-bg-atelier' }, redirect: 'follow' })
      if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 404 ? '（Release 资产还没发布？）' : ''))
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length !== item.bytes) throw new Error('字节数不符：拿到 ' + buf.length + '，清单写 ' + item.bytes)
      const got = sha256(buf)
      if (got !== item.sha256) throw new Error('sha256 不符：拿到 ' + got.slice(0, 12) + '…，清单写 ' + item.sha256.slice(0, 12) + '…')
      return buf
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('未知错误')
}

/**
 * 取回缺的底图。
 * @returns {Promise<{ok:boolean,total:number,downloaded:number,skipped:number,failed:number,bytes:number,errors:Array}>}
 */
export async function fetchWallpapers(opts = {}) {
  const pluginDir = opts.pluginDir || PLUGIN_DIR
  const manifest = opts.manifest || readManifest(pluginDir)
  const onProgress = opts.onProgress || (() => {})
  const concurrency = Math.max(1, Math.min(8, opts.concurrency || 3))
  const root = path.join(pluginDir, 'wallpapers')
  const items = manifest.items
  const out = { ok: true, total: items.length, downloaded: 0, skipped: 0, failed: 0, bytes: 0, errors: [] }

  const queue = items.slice()
  let done = 0
  async function worker() {
    for (;;) {
      const item = queue.shift()
      if (!item) return
      const target = path.join(root, item.path)
      let state = checkLocal(target, item).state
      if (state === 'ok') {
        out.skipped++
      } else {
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          const buf = await downloadOne(manifest.release.base + '/' + item.asset, item, opts)
          const tmp = target + '.part'
          fs.writeFileSync(tmp, buf)
          fs.renameSync(tmp, target)
          out.downloaded++
          out.bytes += buf.length
        } catch (e) {
          out.failed++
          out.errors.push({ asset: item.asset, path: item.path, error: String((e && e.message) || e) })
        }
      }
      done++
      onProgress({ done, total: items.length, asset: item.asset, path: item.path, state, downloaded: out.downloaded, skipped: out.skipped, failed: out.failed, bytes: out.bytes })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  out.ok = out.failed === 0
  return out
}

/** 本机现有底图的完整性快照（不联网）：{ ok, missing, bad, total } —— 设置页"检查"按钮用。 */
export function verifyLocal(pluginDir = PLUGIN_DIR) {
  let manifest
  try { manifest = readManifest(pluginDir) } catch { return { ok: false, reason: '没有清单文件 ' + MANIFEST_FILE, total: 0, missing: [], bad: [] } }
  const root = path.join(pluginDir, 'wallpapers')
  const missing = [], bad = []
  for (const item of manifest.items) {
    const s = checkLocal(path.join(root, item.path), item)
    if (s.state === 'missing') missing.push(item.path)
    else if (s.state === 'bad') bad.push(item.path)
  }
  return { ok: missing.length === 0 && bad.length === 0, total: manifest.items.length, local: manifest.items.length - missing.length - bad.length, missing, bad }
}

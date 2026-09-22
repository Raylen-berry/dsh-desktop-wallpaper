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
//  · 单张有**时间预算**（timeoutMs，默认 300000）：慢连接不会让任务无限停在"下载中"，超时算一次失败、走退避重试。
//  · **流式下载**：边收边写 .part、边累计 sha256，字节数一超清单值立刻中止 —— 不把整张图（最大 60.4MB）读进内存。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
export const MANIFEST_FILE = 'wallpapers.manifest.json'

/** 单张下载的时间预算（毫秒）。清单里最大的一张 63283616 B（60.4MB），家用宽带预留足够余量。 */
export const DEFAULT_TIMEOUT_MS = 300000
/** 单张下载的重试次数（不含首次尝试）。 */
export const DEFAULT_RETRIES = 2

// ---- 本机网络绕行（2026-09-23）----
// 现象：objects.githubusercontent.com 对本机直连会 **TLS 层 ECONNRESET**（GitHub API 与
// Release HTML 页都正常，只有资产 CDN 挂 ⇒ 排查时极易误判成"资产没传上去"）。
// 解法：同目录放一个 .env.local（不进 git），一行 PROXY=http://127.0.0.1:<port> ——
// 只给取图/发布的 fetch 走代理，不改系统、不影响 git 与其它任何程序。文件不在就一切照旧。
let proxyUrl = null
try {
  const envFile = path.join(PLUGIN_DIR, '.env.local')
  if (fs.existsSync(envFile)) {
    const m = /^\s*PROXY\s*=\s*(\S+)/im.exec(fs.readFileSync(envFile, 'utf8'))
    if (m) proxyUrl = m[1]
  }
} catch { /* 读不到就当没配 */ }
export function getProxyUrl() { return proxyUrl }

/** 给 fetch 用的选项：配了 PROXY 就注入 proxy 键（Node ≥24 认；更老的运行时只会因未知键被忽略或
 *  连接失败 —— downloadOne 里有"不支持就删掉重连一次"的兜底，不会把下载搞挂）。 */
export function fetchOpts(extra = {}) {
  const o = { ...extra }
  if (proxyUrl) o.proxy = proxyUrl
  return o
}

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

// 失败分类：HTTP 错误 / 字节数不符 / sha256 不符 / 超时 / 已取消。
// 外部取消（opts.signal）立即停、**不重试**；其余都算"一次失败"、照常退避重试。
class DownloadError extends Error {
  constructor(message, { retryable = true } = {}) { super(message); this.name = 'DownloadError'; this.retryable = retryable }
}
const timeoutError = (ms) => new DownloadError('下载超时：' + ms + 'ms 内没下完（可用 opts.timeoutMs 覆盖）')
const abortError = () => new DownloadError('已取消：外部 signal 触发，立即停止（不重试）', { retryable: false })
const aborted = (sig) => !!(sig && sig.aborted)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 边收边写 dst、边累计 sha256 与字节数；字节数一超清单值立刻抛，不把响应读完。 */
function streamToFile(body, item, dst) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const ws = fs.createWriteStream(dst)
    let received = 0
    let settled = false
    const fail = (err) => { if (!settled) { settled = true; try { ws.destroy() } catch {} ; reject(err) } }
    const ok = () => { if (!settled) { settled = true; resolve({ bytes: received, sha256: hash.digest('hex') }) } }
    ws.on('error', fail)
    const write = (buf) => new Promise((res, rej) => {
      ws.write(buf, (err) => (err ? rej(err) : res()))
    })
    ;(async () => {
      try {
        for await (const chunk of body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          if (!buf.length) continue
          received += buf.length
          if (received > item.bytes) {
            // 清单说只有 item.bytes，多出来的第 1 字节就中止 —— 不等下完
            return fail(new DownloadError('字节数不符：已收到 ' + received + '，清单写 ' + item.bytes + '（超长立刻中止，响应未读完）'))
          }
          hash.update(buf)
          await write(buf)
        }
        await new Promise((res, rej) => ws.end((err) => (err ? rej(err) : res())))
        if (received !== item.bytes) return fail(new DownloadError('字节数不符：收到 ' + received + '，清单写 ' + item.bytes))
        ok()
      } catch (e) { fail(e) }
    })()
  })
}

async function downloadOne(url, item, tmp, opts) {
  const retries = Number.isInteger(opts.retries) && opts.retries >= 0 ? opts.retries : DEFAULT_RETRIES
  const timeoutMs = Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
  const outer = opts.signal
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (aborted(outer)) throw abortError()          // 外部取消：立刻停，也不重试
    if (attempt) await sleep(400 * attempt * attempt)   // 退避
    const ac = new AbortController()
    const onOuterAbort = () => ac.abort()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    if (outer) outer.addEventListener('abort', onOuterAbort, { once: true })
    try {
      if (typeof fetch !== 'function') throw new DownloadError('本机 Node 没有全局 fetch（需要 Node 18+）')
      let res
      try {
        const opts = fetchOpts({ headers: { 'user-agent': 'dsh-bg-atelier' }, redirect: 'follow', signal: ac.signal })
        // 本机绕行：见文件头 getProxyUrl 的注释（objects CDN 直连被 TLS reset，API 不受影响）。
        try {
          res = await fetch(url, opts)
        } catch (e) {
          if (opts.proxy && /proxy/i.test(String((e && e.message) || e))) {
            delete opts.proxy
            res = await fetch(url, opts)
          } else throw e
        }
      } catch (e) {
        if (aborted(outer)) throw abortError()
        if (ac.signal.aborted) throw timeoutError(timeoutMs)
        throw new DownloadError('请求失败：' + String((e && e.message) || e))
      }
      if (!res.ok) throw new DownloadError('HTTP ' + res.status + (res.status === 404 ? '（Release 资产还没发布？）' : ''))
      try {
        let got
        if (!res.body || typeof res.body[Symbol.asyncIterator] !== 'function') {
          // 极端降级：运行时没有可迭代的响应体流（Node 18+ 的 undici 一定有）
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length !== item.bytes) throw new DownloadError('字节数不符：收到 ' + buf.length + '，清单写 ' + item.bytes)
          fs.writeFileSync(tmp, buf)
          got = { bytes: buf.length, sha256: sha256(buf) }
        } else {
          got = await streamToFile(res.body, item, tmp)
        }
        // 字节数与 sha256 都对上了才算成功（此时 tmp 已完整落盘）
        if (got.sha256 !== item.sha256) {
          throw new DownloadError('sha256 不符：收到 ' + got.sha256.slice(0, 12) + '…，清单写 ' + item.sha256.slice(0, 12) + '…')
        }
        return got
      } catch (e) {
        if (aborted(outer)) { ac.abort(); throw abortError() }
        if (ac.signal.aborted) throw timeoutError(timeoutMs)
        if (e instanceof DownloadError) { ac.abort(); throw e }   // 校验不通过：顺手掐掉还没读完的响应体
        throw new DownloadError('读取响应失败：' + String((e && e.message) || e))
      }
    } catch (e) {
      if (aborted(outer) || e.retryable === false) throw e    // 取消：不重试、也不说是"重试耗尽"
      lastErr = e
    } finally {
      clearTimeout(timer)
      if (outer) outer.removeEventListener('abort', onOuterAbort)
    }
  }
  throw lastErr || new DownloadError('未知错误')
}

/**
 * 取回缺的底图。
 * @param {object} [opts]
 * @param {number} [opts.retries=2] 单张重试次数（不含首次尝试）；必须是非负整数，非法值回落到 2。0 = 只试一次。
 * @param {number} [opts.timeoutMs=300000] 单张时间预算；超时算一次失败、走退避重试。必须正整数，非法值回落到 300000。
 * @param {AbortSignal} [opts.signal] 外部取消信号；触发后立即停止且不再重试（错误消息标明"已取消"）。
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
        // 先写 target.part，校验通过才 rename 到最终路径 —— 既有约定不变
        const tmp = target + '.part'
        let renamed = false
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          const got = await downloadOne(manifest.release.base + '/' + item.asset, item, tmp, opts)
          fs.renameSync(tmp, target)
          renamed = true
          out.downloaded++
          out.bytes += got.bytes
        } catch (e) {
          out.failed++
          out.errors.push({ asset: item.asset, path: item.path, error: String((e && e.message) || e) })
        } finally {
          if (!renamed) { try { fs.unlinkSync(tmp) } catch {} }
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

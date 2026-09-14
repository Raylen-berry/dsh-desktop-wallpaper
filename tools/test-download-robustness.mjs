// 离线断言：下载健壮性（**不联网**、不碰真实 wallpapers/、不发真实下载）
// ============================================================================
// 跑法：node tools/test-download-robustness.mjs
// 覆盖：① retries:0 只尝试 1 次 ② 超时按失败处理并按 retries 重试 ③ 外部取消不重试且不误报"重试耗尽"
//       ④ 字节数超清单值立刻中止（不读完响应体） ⑤ 哈希不符不落盘、不覆盖已有正确文件 ⑥ 正常响应落盘且 sha256 正确
//
// 手法：把 globalThis.fetch 打成桩，按 URL 决定行为；插件目录指向临时目录，
// 所以真实 wallpapers/（39 张 / 820MB）一个字节都不会被读或写。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fetchWallpapers, readManifest, checkLocal, DEFAULT_TIMEOUT_MS, DEFAULT_RETRIES } from '../fetch-wallpapers.js'

let pass = 0, fail = 0
const results = []
function ok(name, cond, detail = '') {
  if (cond) { pass++; results.push('  ✓ ' + name) }
  else { fail++; results.push('  ✗ ' + name + (detail ? '  —— ' + detail : '')) }
}
const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bga-dl-test-'))
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REAL_MANIFEST = readManifest(path.join(HERE, '..'))

/** 建一个只含指定 items 的假插件目录，返回 { dir, manifest, target(item) } */
function makePluginDir(name, items) {
  const dir = path.join(tmpRoot, name)
  fs.mkdirSync(path.join(dir, 'wallpapers'), { recursive: true })
  const manifest = {
    format: 'dsh-bg-atelier-wallpapers/1',
    total: items.length,
    totalBytes: items.reduce((a, i) => a + i.bytes, 0),
    release: { base: 'http://stub.invalid/releases/download/wallpapers-v1' },
    items,
  }
  return { dir, manifest, target: (item) => path.join(dir, 'wallpapers', item.path) }
}
const itemFor = (asset, body, over = {}) => ({
  asset,
  path: '桩/' + asset,
  bytes: body.length,
  sha256: sha256hex(body),
  note: '离线断言桩',
  ...over,
})

/** 把 fetch 换成桩；返回 { calls, restore } */
function stubFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init, calls.length - 1)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

/** 造一个"服务端流"：按需产出 totalBytes 字节（与给定 body 逐字节一致），并记录它到底被消费了多少 */
function countingStream(totalBytes, { chunk = 65536, fill = 0x41 } = {}) {
  const stats = { produced: 0, pulls: 0 }
  let sent = 0
  const stream = new ReadableStream({
    async pull(controller) {
      await sleep(3)                     // 让"边下边算"的时序真的发生（真流不是同步的）
      stats.pulls++
      const n = Math.min(chunk, totalBytes - sent)
      if (n <= 0) { controller.close(); return }
      const buf = Buffer.alloc(n, fill)
      sent += n
      stats.produced += n
      controller.enqueue(new Uint8Array(buf))
    },
  })
  return { stream, stats }
}
/** 从一个 Buffer 造一次性流 */
const bufferStream = (buf) => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close() } })
const responseOf = (stream, init = {}) => new Response(stream, { status: 200, ...init })

/** 断言打印出来的 item 确实带 sha256（否则"哈希不符"那条根本测不到东西） */
function saneItem(item) {
  if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) {
    throw new Error('测试自检失败：item.sha256 不是 64 位十六进制（' + item.asset + ' → ' + String(item.sha256) + '）')
  }
  return item
}

console.log('离线下载健壮性断言 · 临时目录 ' + tmpRoot)
console.log('（清单真实值：' + REAL_MANIFEST.total + ' 张 / ' + REAL_MANIFEST.totalBytes + ' B；默认 timeoutMs=' + DEFAULT_TIMEOUT_MS + ' retries=' + DEFAULT_RETRIES + '）')
console.log('')

// ── ① retries: 0 ⇒ 只尝试 1 次 ─────────────────────────────────────────────
{
  const body = Buffer.from('A'.repeat(4096))
  const item = itemFor('w01.jpg', body)
  const { dir, manifest, target } = makePluginDir('retries0', [item])
  const s = stubFetch(async () => { throw new Error('stub: 网络炸了') })
  try {
    const out = await fetchWallpapers({ pluginDir: dir, manifest, retries: 0, timeoutMs: 500 })
    ok('① retries:0 请求数 = 1', s.calls.length === 1, '实际 ' + s.calls.length)
    ok('① retries:0 errors 数 = 1', out.errors.length === 1, '实际 ' + out.errors.length)
    ok('① retries:0 failed = 1 且 ok = false', out.failed === 1 && out.ok === false, 'failed=' + out.failed + ' ok=' + out.ok)
    ok('① retries:0 没有落盘', !fs.existsSync(target(item)))
    // 顺带钉住"非法值回落 2"（-1 不是非负整数 ⇒ 回落 2 ⇒ 共 3 次尝试）
    const s2 = stubFetch(async () => { throw new Error('stub') })
    try {
      await fetchWallpapers({ pluginDir: dir, manifest, retries: -1, timeoutMs: 500 })
      ok('① retries:-1 非法值回落到 2（共 3 次尝试）', s2.calls.length === 3, '实际 ' + s2.calls.length)
    } finally { s2.restore() }
  } finally { s.restore() }
}

// ── ② 超时：按一次失败处理，并按 retries 重试 ────────────────────────────────
{
  const body = Buffer.from('B'.repeat(2048))
  const item = itemFor('w02.jpg', body)
  const { dir, manifest } = makePluginDir('timeout', [item])
  // 桩：一直挂着，直到自己被 abort（模拟慢连接把响应头都拖着不给）。
  // 另给一个 hardCap：若实现压根没传信号（改动前的旧实现就是这样），也不会把测试挂死。
  const hardCap = 4000
  const s = stubFetch((url, init) => new Promise((_, reject) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; reject(new Error('stub: aborted')) } }
    if (init.signal) init.signal.addEventListener('abort', done)
    setTimeout(done, hardCap)
  }))
  try {
    const out = await fetchWallpapers({ pluginDir: dir, manifest, retries: 1, timeoutMs: 150 })
    ok('② 超时按失败处理并按 retries 重试：请求数 = 2', s.calls.length === 2, '实际 ' + s.calls.length)
    ok('② errors 数 = 1（不是 1 张报 2 条）', out.errors.length === 1, '实际 ' + out.errors.length)
    ok('② 错误消息标明超时', /超时/.test(out.errors[0] ? out.errors[0].error : ''), out.errors[0] && out.errors[0].error)
    ok('② 错误消息带上 timeoutMs 数字', /150/.test(out.errors[0] ? out.errors[0].error : ''), out.errors[0] && out.errors[0].error)
    ok('② 错误消息没有误报"重试耗尽"',
      !/重试耗尽|重试次数用尽|尝试次数已用尽/.test(out.errors[0] ? out.errors[0].error : ''),
      out.errors[0] && out.errors[0].error)
    const sig = s.calls[0] && s.calls[0].init && s.calls[0].init.signal
    ok('② fetch 确实拿到了 AbortSignal', sig instanceof AbortSignal)
    ok('② 内部取消信号在超时后已触发', !!(sig && sig.aborted === true))
  } finally { s.restore() }
}

// ── ③ 外部取消：立即停、不重试、不误报"重试耗尽" ────────────────────────────
{
  const body = Buffer.from('C'.repeat(2048))
  const item = itemFor('w03.jpg', body)
  const { dir, manifest } = makePluginDir('abort', [item])
  const outer = new AbortController()
  // 桩：挂着等 abort；hardCap 保证"没实现取消"时测试也不会挂死
  const hardCap = 4000
  const s = stubFetch((url, init) => new Promise((_, reject) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; reject(new Error('stub: aborted')) } }
    if (init.signal) init.signal.addEventListener('abort', done)
    setTimeout(done, hardCap)
  }))
  try {
    setTimeout(() => outer.abort(), 60)
    const out = await fetchWallpapers({ pluginDir: dir, manifest, retries: 3, timeoutMs: 30000, signal: outer.signal })
    ok('③ 外部取消后不重试：请求数 = 1', s.calls.length === 1, '实际 ' + s.calls.length + '（retries:3 本该最多 4 次）')
    ok('③ errors 数 = 1', out.errors.length === 1, '实际 ' + out.errors.length)
    ok('③ 错误消息标明"已取消"', /已取消/.test(out.errors[0] ? out.errors[0].error : ''), out.errors[0] && out.errors[0].error)
    ok('③ 错误消息没有误报"重试耗尽"',
      !/重试耗尽|重试次数用尽|尝试次数已用尽/.test(out.errors[0] ? out.errors[0].error : ''),
      out.errors[0] && out.errors[0].error)
    ok('③ 没有落盘', !fs.existsSync(path.join(dir, 'wallpapers', item.path)))
  } finally { s.restore() }
}
// 已提前取消的信号：连一次请求都不该发
{
  const body = Buffer.from('D'.repeat(1024))
  const item = itemFor('w03b.jpg', body)
  const { dir, manifest } = makePluginDir('preaborted', [item])
  const outer = new AbortController()
  outer.abort()
  const s = stubFetch(async () => responseOf(new ReadableStream({ start: (c) => c.close() })))
  try {
    const out = await fetchWallpapers({ pluginDir: dir, manifest, retries: 3, timeoutMs: 500, signal: outer.signal })
    ok('③ 进来就已被取消：请求数 = 0', s.calls.length === 0, '实际 ' + s.calls.length)
    ok('③ 进来就已被取消：消息标明"已取消"', /已取消/.test(out.errors[0] ? out.errors[0].error : ''), out.errors[0] && out.errors[0].error)
  } finally { s.restore() }
}

// ── ④ 字节数超清单值：立刻中止，不把响应读完 ─────────────────────────────────
{
  const want = 3 * 65536                    // 清单说 192KB
  const serve = 200 * 65536                 // 服务端故意发 12.5MB
  const item = { asset: 'w04.png', path: '桩/w04.png', bytes: want, sha256: sha256hex(Buffer.alloc(want, 0x41)), note: '超长流' }
  const { dir, manifest, target } = makePluginDir('overlong', [item])
  const { stream, stats } = countingStream(serve)
  const s = stubFetch(async () => responseOf(stream))
  try {
    const out = await fetchWallpapers({ pluginDir: dir, manifest, retries: 0, timeoutMs: 30000 })
    ok('④ 报错且 failed = 1', out.failed === 1, 'failed=' + out.failed + ' errors=' + JSON.stringify(out.errors))
    ok('④ 错误消息是"字节数不符"', /字节数不符/.test(out.errors[0] ? out.errors[0].error : ''), out.errors[0] && out.errors[0].error)
    ok('④ 服务端只被消费了"刚好超限"那点（远小于 12.5MB）',
      stats.produced <= want + 65536,
      '实际产出 ' + stats.produced + ' B / 服务端共 ' + serve + ' B  ⇒ 只消费了 ' + (stats.produced / serve * 100).toFixed(1) + '%')
    ok('④ 没有把响应读完（产出 < 服务端总量）', stats.produced < serve, '产出 ' + stats.produced + ' vs ' + serve)
    const sig4 = s.calls[0] && s.calls[0].init && s.calls[0].init.signal
    ok('④ 内部中止信号被触发', !!(sig4 && sig4.aborted === true), '旧实现根本没有信号 ⇒ 这里会是 false')
    ok('④ 没有落盘（连 .part 都被清掉）',
      !fs.existsSync(target(item)) && !fs.existsSync(target(item) + '.part'))
  } finally { s.restore() }
}

// ── ⑤ 哈希不符：不落盘，也不覆盖已有正确文件 ────────────────────────────────
{
  const good = Buffer.from('E'.repeat(8192))
  const item = saneItem(itemFor('w05.jpg', good))
  const a = makePluginDir('hashwrite', [item])
  // 5a：目标不存在 + 服务端给**字节数相同、内容不同**的响应 ⇒ 只可能被 sha256 拦下，不该落盘
  {
    const evil = Buffer.from('X'.repeat(good.length))
    ok('⑤ 测试自检：evil 与 good 字节数相同、sha256 不同',
      evil.length === good.length && sha256hex(evil) !== item.sha256)
    const s = stubFetch(async () => responseOf(bufferStream(evil)))
    try {
      const out = await fetchWallpapers({ pluginDir: a.dir, manifest: a.manifest, retries: 0, timeoutMs: 5000 })
      ok('⑤ 哈希不符：failed = 1', out.failed === 1, 'failed=' + out.failed + ' errors=' + JSON.stringify(out.errors))
      ok('⑤ 哈希不符：错误消息标明 sha256', /sha256/.test(out.errors[0] ? out.errors[0].error : ''), out.errors[0] && out.errors[0].error)
      ok('⑤ 哈希不符：目标路径不存在', !fs.existsSync(a.target(item)), '目标=' + a.target(item))
      ok('⑤ 哈希不符：.part 已清掉', !fs.existsSync(a.target(item) + '.part'))
    } finally { s.restore() }
  }
  // 5b：已有一份**正确**文件 ⇒ 既不该被覆盖也不该被重复下载
  {
    fs.mkdirSync(path.dirname(a.target(item)), { recursive: true })
    fs.writeFileSync(a.target(item), good)
    const before = fs.statSync(a.target(item)).mtimeMs
    const s = stubFetch(async () => responseOf(bufferStream(Buffer.from('Y'.repeat(good.length)))))
    try {
      const out = await fetchWallpapers({ pluginDir: a.dir, manifest: a.manifest, retries: 0, timeoutMs: 5000 })
      ok('⑤ 已有正确文件：被 skip 而不是重下', out.skipped === 1 && s.calls.length === 0, 'skipped=' + out.skipped + ' calls=' + s.calls.length)
      ok('⑤ 已有正确文件：内容原样（sha256 不变）', sha256hex(fs.readFileSync(a.target(item))) === item.sha256)
      ok('⑤ 已有正确文件：mtime 未变（没被覆盖）', fs.statSync(a.target(item)).mtimeMs === before)
    } finally { s.restore() }
  }
  // 5c：目标处是**损坏**文件 ⇒ 修好它（不因"文件已存在"就跳过）
  {
    fs.writeFileSync(a.target(item), Buffer.from('Z'.repeat(good.length)))
    const s = stubFetch(async () => responseOf(bufferStream(good)))
    try {
      const out = await fetchWallpapers({ pluginDir: a.dir, manifest: a.manifest, retries: 0, timeoutMs: 5000 })
      ok('⑤ 目标处文件损坏：重下并修正', out.downloaded === 1 && sha256hex(fs.readFileSync(a.target(item))) === item.sha256,
        'downloaded=' + out.downloaded + ' errors=' + JSON.stringify(out.errors))
    } finally { s.restore() }
  }
}

// ── ⑥ 正常响应：落盘且 sha256 正确（走流式路径） ─────────────────────────────
{
  const body = Buffer.from('F'.repeat(150000))            // 跨多个 chunk
  const item = saneItem(itemFor('w06.png', body))
  const { dir, manifest, target } = makePluginDir('happy', [item])
  const { stream, stats } = countingStream(body.length, { chunk: 32768, fill: 0x46 })
  const s = stubFetch(async () => responseOf(stream, { headers: { 'content-length': String(body.length) } }))
  try {
    const out = await fetchWallpapers({ pluginDir: dir, manifest, retries: 0, timeoutMs: 30000 })
    ok('⑥ downloaded = 1 且 ok = true', out.downloaded === 1 && out.ok === true, 'downloaded=' + out.downloaded + ' ok=' + out.ok + ' errors=' + JSON.stringify(out.errors))
    ok('⑥ 文件存在且 sha256 正确', fs.existsSync(target(item)) && sha256hex(fs.readFileSync(target(item))) === item.sha256)
    ok('⑥ 字节数与清单一致', fs.existsSync(target(item)) && fs.statSync(target(item)).size === item.bytes)
    ok('⑥ 没有留下 .part', !fs.existsSync(target(item) + '.part'))
    ok('⑥ out.bytes 累计正确', out.bytes === item.bytes, '实际 ' + out.bytes)
    ok('⑥ 整个响应被读完（服务端产出 = 全量）', stats.produced === body.length, '产出 ' + stats.produced)
    ok('⑥ checkLocal 认可落盘结果', checkLocal(target(item), item).state === 'ok')
    // 重入：再跑一次应该全 skip、零请求
    const s2 = stubFetch(async () => { throw new Error('不该被调用') })
    try {
      const out2 = await fetchWallpapers({ pluginDir: dir, manifest, retries: 0, timeoutMs: 5000 })
      ok('⑥ 可重入：第二次全 skip 且 0 请求', out2.skipped === 1 && s2.calls.length === 0, 'skipped=' + out2.skipped + ' calls=' + s2.calls.length)
    } finally { s2.restore() }
  } finally { s.restore() }
}

// ── 收尾 ────────────────────────────────────────────────────────────────────
try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
console.log(results.join('\n'))
console.log('')
console.log('通过 ' + pass + ' / 失败 ' + fail + '（共 ' + (pass + fail) + ' 条断言）')
if (fail) { console.error('\n有断言未通过。'); process.exit(1) }
console.log('全部通过 ✓（未联网、未触碰真实 wallpapers/）')

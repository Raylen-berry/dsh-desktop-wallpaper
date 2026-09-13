// 回归测试：断言「host 供图那条路送出的字节 == 磁盘上的原文件」。
//
// 为什么能这样测：index.js 的 resolveWallpaper 是 apply(ctx) 内的闭包，外部拿不到；
// 但 apply 只用到 ctx 的 `get('webServer')` 与 `effect()`，所以给个假 ctx 就能把
// webServer.register 注册的**真实处理器**抓出来直接调用 —— 不用重启 DSH 就能验证
// host 半的行为（v1.6.1 放开 3840 上限时就是这么验的）。
//
// 用法：node tools/test-served-bytes.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WALL = path.join(ROOT, 'wallpapers')
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const mb = (n) => (n / 1048576).toFixed(2) + 'MB'

if (!fs.existsSync(WALL) || !fs.readdirSync(WALL).length) {
  console.error('没有 wallpapers/（图片不进 git）—— 先跑 `node tools/fetch-wallpapers.mjs` 取回底图再测。')
  process.exit(1)
}

const mod = await import(pathToFileURL(path.join(ROOT, 'index.js')).href)
const routes = []
const fakeCtx = {
  get: (n) => (n === 'webServer' ? { register: (cfg) => { routes.push(cfg); return function () {} } } : undefined),
  effect: (fn) => { fn(); return function () {} },
}
await mod.apply(fakeCtx)
console.log('注册成功 ' + routes.length + ' 条路由：' + routes.map((r) => r.kind + ' ' + r.path).join(' · '))

const route = routes.find((r) => r.kind === 'prefix' && r.path === '/bga/wallpapers')
if (!route) { console.error('没抓到底图路由！'); process.exit(1) }

function request(url) {
  return new Promise(function (resolve) {
    const chunks = []
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers || {} },
      end(body) {
        if (body !== undefined && body !== null) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body))
        resolve({ status: this.status, headers: this.headers, body: Buffer.concat(chunks) })
      },
    }
    Promise.resolve(route.handler({ url }, res)).catch(function (e) { resolve({ status: 0, err: e.message }) })
  })
}

// 取几张真实存在的图：优先挑最大的三张（上限放开后最容易出问题的就是它们）
const files = []
for (const cat of fs.readdirSync(WALL)) {
  const d = path.join(WALL, cat)
  if (!fs.statSync(d).isDirectory()) continue
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    if (fs.statSync(p).isFile()) files.push({ cat, name: f, size: fs.statSync(p).size })
  }
}
files.sort((a, b) => b.size - a.size)
const biggest = files.slice(0, 3)
const sample = files[files.length - 1]

let fail = 0
console.log('\n=== 原图（kind=空）：必须与磁盘文件逐字节相同 ===')
for (const it of biggest.concat([sample])) {
  const disk = fs.readFileSync(path.join(WALL, it.cat, it.name))
  const r = await request('/bga/wallpapers/' + encodeURIComponent(it.cat) + '/' + encodeURIComponent(it.name))
  const ok = r.status === 200 && sha(r.body) === sha(disk)
  if (!ok) fail++
  console.log(`  ${ok ? '✓' : '✗'} ${it.cat}/${it.name}  磁盘 ${mb(disk.length)} / 送出 ${mb(r.body.length)}  status=${r.status}  ${ok ? 'sha256 相同' : 'sha256 不同！'}`)
}

console.log('\n=== 缩略图/派生图：必须仍在缩放（别被上限放开带崩）===')
const one = biggest[0]
for (const [sz, maxKB, wantWebp] of [['thumb', 400, false], ['preview', 200, true], ['poster', 60, true]]) {
  const r = await request('/bga/wallpapers/' + encodeURIComponent(one.cat) + '/' + encodeURIComponent(one.name) + '?sz=' + sz)
  const isWebp = r.body.length > 12 && r.body.slice(8, 12).toString('latin1') === 'WEBP'
  const ok = r.status === 200 && r.body.length > 0 && r.body.length < maxKB * 1024 && (wantWebp ? isWebp : true)
  if (!ok) fail++
  console.log(`  ${ok ? '✓' : '✗'} sz=${sz}  status=${r.status}  ${mb(r.body.length)}  上限 ${maxKB}KB${wantWebp ? '  是 webp' : ''}`)
}

console.log('\n=== 边界 ===')
const miss = await request('/bga/wallpapers/' + encodeURIComponent(one.cat) + '/不存在.png')
console.log(`  ${miss.status === 404 ? '✓' : '✗'} 不存在的图 → ${miss.status}（应为 404）`)
if (miss.status !== 404) fail++
const up = await request('/bga/wallpapers/..%2F..%2Findex.js')
console.log(`  ${up.status !== 200 ? '✓' : '✗'} 路径穿越 → ${up.status}（不应 200）`)
if (up.status === 200) fail++

console.log(fail ? `\n结果：${fail} 项不合格` : '\n结果：全部通过 ✓')
process.exit(fail ? 1 : 0)

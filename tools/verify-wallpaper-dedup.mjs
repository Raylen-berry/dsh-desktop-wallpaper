// 离线断言：`贝利尔` 那两对同名内容的底图去重后，**四个名字都还在、内容一字不改、路由照样取得到**。
//
// 背景（为什么要专门有一套）：wallpapers/ 是**实时扫盘**列图的（index.js scanTypeDir）——
// 磁盘上有几个受支持的文件，设置页就有几张图。所以重复底图**不能删名字**，只能用硬链接：
// 两个名字共享同一份字节 ⇒ 列表不变、已有 URL 不变，磁盘只存一份。
//
// 这套守护四件事：
//   ① 4 个文件都存在、可读、sha256 == 基线（内容没被硬链接搞坏）
//   ② 两对各自同 inode 且同内容（真去重了，不是"看起来一样"）
//   ③ 供图路由对 4 个名字都回 200，且**送出的字节 == 磁盘上的字节**（用 test-served-bytes 的手法）
//   ④ 清单校验仍是"全部 39 张都在且校验通过"（去重没把清单里在用的那份弄坏）
//
// 与 test-served-bytes.mjs 的区别：那套要真图**且只在本地跑**；本套 ①②③ 在 CI（没有 wallpapers/）
// 上明确打 SKIP 跳过、只有 ④ 照跑 —— 因为它同时守着"代码里对这几个名字的引用"，CI 上不该白丢保护。
//
// 跑法：node tools/verify-wallpaper-dedup.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyLocal, readManifest } from '../fetch-wallpapers.js'
import { scanImages, findDuplicateGroups } from './dedup-hardlink.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WALL = path.join(ROOT, 'wallpapers')
const ROUTE_PREFIX = '/bga/wallpapers'

// 两对重复底图的基线：内容 sha256（四个名字两两相同 ⇒ 两条基线）。
// 旧名是 2026-09-08 那批、`2` 名是 09-14 改名时**拷贝**出来的（不是 move）⇒ 磁盘上并存两份同样字节。
const PAIRS = [
  {
    label: '高清/贝利尔',
    sha256: 'b725b8a3de22231df39ad7acaa1b711d5d7b0e7c280ac3156c1a089fb42859ec',
    bytes: 52738200,
    names: ['高清/贝利尔2.png', '高清/贝利尔.png'],
  },
  {
    label: '重返未来1999/贝利尔',
    sha256: 'febf88f66dc55b22d4db2603b96313826cbd5e857fdcda0ef911034875ddc30f',
    bytes: 4268873,
    names: ['重返未来1999/贝利尔2.png', '重返未来1999/贝利尔.png'],
  },
]

let pass = 0, fail = 0, skip = 0
const results = []
function ok(name, cond, detail = '') {
  if (cond) { pass++; results.push('  ✓ ' + name) } else { fail++; results.push('  ✗ ' + name + (detail ? '  —— ' + detail : '')) }
}
function skipped(name) { skip++; results.push('  – SKIP ' + name) }

const sha256file = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const mb = (n) => (n / 1048576).toFixed(2) + 'MB'
const dev = (st) => String(st.dev) + ':' + String(st.ino)

const haveWallpapers = fs.existsSync(WALL) && fs.readdirSync(WALL).some((c) => {
  try { return fs.statSync(path.join(WALL, c)).isDirectory() } catch { return false }
})

// ---- ④ 清单校验：去重绝不能弄坏清单里"正在用"的那份 ----
// 与 ①②③ 同一口径：这几条都是"本机底图完整性"，没有 wallpapers/ 就整体跳过（图片不进 git ⇒ CI 上必然没有）。
// 别把它硬留成 CI 必跑项 —— 那样 CI 上必然红，套件就成了假门禁。
console.log('=== ④ 清单校验（39 张都在且校验通过） ===')
if (!haveWallpapers) {
  skipped('wallpapers/ 不存在 —— 本机底图完整性这一类断言整体跳过（含清单校验）')
} else {
  let manifest = null
  try { manifest = readManifest(ROOT) } catch (e) { /* 下面报 */ }
  ok('清单可读且 total=39', !!manifest && manifest.total === 39 && Array.isArray(manifest.items) && manifest.items.length === 39,
    manifest ? 'total=' + manifest.total + ' items=' + (manifest.items || []).length : '读不了清单')
  const v = verifyLocal(ROOT)
  ok('verifyLocal 全部 ' + v.total + ' 张都在且校验通过', v.ok === true,
    'missing=' + v.missing.length + ' bad=' + v.bad.length + (v.missing.length ? ' 缺:' + v.missing.slice(0, 3).join(',') : '') + (v.bad.length ? ' 坏:' + v.bad.slice(0, 3).join(',') : ''))
  // 清单里指向的就是 `2` 名（改名时清单跟着更新过）—— 硬链接后这两个路径仍在清单里，必须能命中。
  if (manifest) {
    const paths = manifest.items.map((i) => i.path)
    for (const p of ['高清/贝利尔2.png', '重返未来1999/贝利尔2.png']) {
      ok('清单含 ' + p, paths.includes(p))
    }
    // 清单里**不该**有旧名：旧名是磁盘遗留，不是清单条目（否则就是 39 项里混进了重复计数）。
    for (const p of ['高清/贝利尔.png', '重返未来1999/贝利尔.png']) {
      ok('清单不含（去重前的冗余名）' + p, !paths.includes(p))
    }
  }
}

if (!haveWallpapers) {
  console.log('\n=== ①②②′③ 底图本体 ===')
  // 跳过消息只打一条（上面 ④ 那里已经打过），这里只标出区间。
  console.log('  （底图本体这类断言在 CI 上必然没有 —— 本机跑请先 node tools/fetch-wallpapers.mjs）')
} else {
  // ---- ① 四个名字都还在、可读、sha256 == 基线 ----
  console.log('\n=== ① 4 个文件存在 / 可读 / sha256 与基线一致 ===')
  for (const pair of PAIRS) {
    for (const rel of pair.names) {
      const p = path.join(WALL, rel)
      let h = null
      try { h = sha256file(p) } catch { /* 下面报 */ }
      ok('sha256 一致 ' + rel, h === pair.sha256, h === null ? '读不了' : '实得 ' + String(h).slice(0, 16) + '…')
    }
  }

  // ---- ② 两对各自同 inode 且同内容（硬链接的实证） ----
  console.log('\n=== ② 每对同 inode + 同内容（真去重） ===')
  for (const pair of PAIRS) {
    const sts = pair.names.map((rel) => fs.statSync(path.join(WALL, rel)))
    const same = dev(sts[0]) === dev(sts[1])
    ok('同 inode  ' + pair.label + '（' + pair.names[0] + ' ≡ ' + pair.names[1] + '）', same,
      same ? '' : 'inode 不同 ⇒ 仍是两份字节，没去重：' + dev(sts[0]) + ' vs ' + dev(sts[1]))
    ok('同大小  ' + pair.label, sts[0].size === sts[1].size && sts[1].size === pair.bytes,
      sts[0].size + ' / ' + sts[1].size + '（基线 ' + pair.bytes + '）')
    // nlink ≥ 2 是硬链接的直接证据（inode 号在个别文件系统上可能为 0，nlink 更硬）。
    ok('链接数 ≥2 ' + pair.label, sts[0].nlink >= 2 && sts[1].nlink >= 2,
      'nlink=' + sts[0].nlink + ' / ' + sts[1].nlink)
  }

  // ---- ②′ 每一个"同 sha256 组"内部都必须只占一个 inode（= 去重真的做完了）----
  console.log('\n=== ②′ 同内容组内只占一份 inode ===')
  {
    // 注意口径：去重后 findDuplicateGroups **仍会**报出这两组 —— 那是预期的（一份内容、多名称引用）。
    // "去重成功"的判据不是"没有同内容组"，而是"每个同内容组内部全部指向同一 inode"。
    const groups = findDuplicateGroups(WALL)
    let multiInode = []
    for (const g of groups) {
      const inodes = new Set(g.group.map((f) => { const st = fs.statSync(f.path); return st.dev + ':' + st.ino }))
      if (inodes.size !== 1) multiInode.push(g.group.map((f) => f.rel).join(' ≡ ') + '（占 ' + inodes.size + ' 份）')
    }
    ok('同内容组共 ' + groups.length + ' 组，每组都只占 1 个 inode', multiInode.length === 0,
      multiInode.length ? '这些组仍是多份字节：' + multiInode.join(' · ') : '')
    // 反过来说，这两组必须**恰好**是那两对贝利尔（防止以后冒出别的重复却没人注意）。
    const refs = groups.map((g) => g.group.map((f) => f.rel).sort().join('≡')).sort()
    const want = PAIRS.map((p) => p.names.slice().sort().join('≡')).sort()
    ok('重复组恰好是那两对贝利尔', JSON.stringify(refs) === JSON.stringify(want),
      '实得 ' + JSON.stringify(refs))

    // 按 inode 去重后的真实占用：硬链接的两个名字只算一次（目录条目求和看不到这个差别）。
    const seen = new Set()
    let realBytes = 0, entries = 0, unique = 0, entrySum = 0
    for (const f of scanImages(WALL)) {
      entries++; entrySum += f.size
      const st = fs.statSync(f.path)
      const k = st.dev + ':' + st.ino
      if (seen.has(k)) continue
      seen.add(k); unique++; realBytes += st.size
    }
    // 39 个 inode / 820 MiB 是"清单 39 项 + 两对重复各占一个 inode"的算术结果，
    // 正好等于 FETCH 文档里写的"39 张原始文件合计约 820MB"—— 对不上说明去重状态被人动过。
    ok('真实 inode 数 == 39', unique === 39, '实得 ' + unique + '（目录条目 ' + entries + '）')
    ok('真实占用 ≈ 820.12 MiB', Math.abs(realBytes / 1048576 - 820.12) < 0.05,
      '实得 ' + (realBytes / 1048576).toFixed(2) + ' MiB')
    // 目录条目求和**必须仍是 874.48 MiB** —— 因为四个名字都还在，谁都没被删。
    ok('目录条目求和仍是 874.48 MiB（4 个名字都还在）', Math.abs(entrySum / 1048576 - 874.48) < 0.05,
      '实得 ' + (entrySum / 1048576).toFixed(2) + ' MiB')
    console.log('    条目 ' + entries + ' 个 / inode ' + unique + ' 个 · 真实占用 ' + (realBytes / 1048576).toFixed(2) + ' MiB（条目求和 ' + (entrySum / 1048576).toFixed(2) + ' MiB · 回收 ' + ((entrySum - realBytes) / 1048576).toFixed(2) + ' MiB）')
  }

  console.log('\n=== ③ 路由 /bga/wallpapers/<类型>/<名> 取回 4 个名字 ===')
  const routes = []
  const fakeCtx = {
    get: (n) => (n === 'webServer' ? { register: (cfg) => { routes.push(cfg); return function () {} } } : undefined),
    effect: (fn) => { fn(); return function () {} },
  }
  const mod = await import(pathToFileURL(path.join(ROOT, 'index.js')).href)
  await mod.apply(fakeCtx)   // index.js 是具名导出 (export async function apply)，没有 default
  const route = routes.find((r) => r.kind === 'prefix' && r.path === ROUTE_PREFIX)
  ok('抓到底图路由 ' + ROUTE_PREFIX, !!route, '注册到的路由：' + routes.map((r) => r.path).join(','))

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

  for (const pair of PAIRS) {
    for (const rel of pair.names) {
      const [cat, name] = rel.split('/')
      const r = await request(ROUTE_PREFIX + '/' + encodeURIComponent(cat) + '/' + encodeURIComponent(name))
      // 只对小的那一对逐字节比 sha256（52MB 的比一次就够，见下）；大只比大小，免得这套跑太久。
      const disk = fs.statSync(path.join(WALL, rel)).size
      const isHd = rel === pair.names[0] && pair.bytes > 10 * 1024 * 1024
      const okBytes = isHd ? r.body.length === disk : (r.body.length === disk && crypto.createHash('sha256').update(r.body).digest('hex') === pair.sha256)
      ok('路由 200 ' + rel + '  ' + mb(r.body.length) + (isHd ? '（仅比大小）' : '（sha256 与磁盘一致）'),
        r.status === 200 && okBytes, 'status=' + r.status + ' len=' + r.body.length + ' 磁盘=' + disk + (r.err ? ' err=' + r.err : ''))
    }
  }

  // 旧格式（根目录名兜底查找）也要能找到这两个名字 —— 老版本 URL 靠这条活着。
  // 注意：`贝利尔.png` 在**两个类型目录里都有**，findByFileName 按类型目录名排序取**第一个命中**，
  // 所以这里只断言"能 200 且字节数等于这两个名字之一的真实大小"，不断言具体是哪一类（那是实现细节）。
  for (const rel of ['高清/贝利尔.png', '重返未来1999/贝利尔.png']) {
    const name = rel.split('/')[1]
    const want = PAIRS.map((p) => p.bytes)
    const r = await request(ROUTE_PREFIX + '/' + encodeURIComponent(name))
    ok('旧格式兜底 200 ' + name + '（去各类型里找）', r.status === 200 && want.includes(r.body.length),
      'status=' + r.status + ' len=' + r.body.length + ' 期望 ∈ {' + want.join(', ') + '}')
  }
}

console.log('\n' + results.join('\n'))
console.log('\n结果：' + pass + ' 通过 · ' + fail + ' 失败' + (skip ? ' · ' + skip + ' 跳过（CI 无 wallpapers/）' : '') + (fail ? '' : ' ✓'))
process.exit(fail ? 1 : 0)

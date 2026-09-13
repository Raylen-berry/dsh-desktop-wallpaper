// 【可选】生成一套"轻量版"底图：长边 > 3840 的缩到 3840，全部转 WebP（q92；小图同时试无损、取更小者）。
//
// 注意：**发布用不到这个脚本**。Release 资产一律是原始文件（无损，见 README A 节），
// 本脚本只是给"想省下载量/省内存"的人留的一条路：生成到 wallpapers_light/，自己决定怎么用。
// 本机显示其实也不吃亏 —— host 供图时本来就有 SERVED_MAX_DIM = 3840 的上限。
//
// 用法：node tools/compress-wallpapers.mjs [--dry] [--out <目录>]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'wallpapers')
const i = process.argv.indexOf('--out')
const DST = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(ROOT, 'wallpapers_light')
const MAXW = 3840
const Q = 92
const SMALL = 8 * 1024 * 1024
const dry = process.argv.includes('--dry')

// sharp 不在插件的依赖里：宿主（DSH Desktop）自带一份，按部署路径逐个试。
const SHARP_CANDIDATES = [
  'sharp',
  path.join(process.env.DSH_APP_ROOT || '', 'node_modules', 'sharp', 'dist', 'index.cjs'),
  'D:/deepseek dsh/DSH Desktop/resources/app/node_modules/sharp/dist/index.cjs',
  'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/sharp/dist/index.cjs',
]
let sharp = null
for (const c of SHARP_CANDIDATES) {
  if (!c) continue
  try {
    const mod = await import(c.startsWith('D:') ? pathToFileURL(c).href : c)
    sharp = mod.default || mod
    console.log('使用 sharp：' + c)
    break
  } catch { /* 试下一个 */ }
}
if (!sharp) { console.error('找不到 sharp —— 插件宿主里有，命令行下请设 DSH_APP_ROOT 指向 DSH Desktop 的 resources/app'); process.exit(1) }
if (!fs.existsSync(SRC)) { console.error('没有 wallpapers/ 目录：' + SRC); process.exit(1) }

const mb = (n) => (n / 1048576).toFixed(2) + 'MB'
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name)
  return d.isDirectory() ? walk(p) : (d.isFile() ? [p] : [])
})

const files = walk(SRC).sort()
console.log('待处理 ' + files.length + ' 张 → ' + DST + (dry ? '（演练，不写盘）' : ''))
let srcTotal = 0, dstTotal = 0, ok = 0, fail = 0
for (const f of files) {
  const rel = path.relative(SRC, f)
  const out = path.join(DST, rel.replace(/\.[^.]+$/, '') + '.webp')
  const srcBytes = fs.statSync(f).size
  srcTotal += srcBytes
  try {
    const meta = await sharp(f, { limitInputPixels: false }).metadata()
    const resize = (meta.width || 0) > MAXW
    const base = () => {
      const s = sharp(f, { limitInputPixels: false })
      return resize ? s.resize({ width: MAXW, kernel: 'lanczos3' }) : s
    }
    const lossy = await base().webp({ quality: Q, effort: 5 }).toBuffer()
    let best = lossy, mode = 'lossy-q' + Q
    if (srcBytes < SMALL) {
      const lossless = await base().webp({ lossless: true, effort: 5 }).toBuffer()
      if (lossless.length < best.length) { best = lossless; mode = 'lossless' }
    }
    if (!dry) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, best) }
    dstTotal += best.length
    ok++
    console.log('  ' + rel + '  ' + mb(srcBytes) + ' → ' + mb(best.length) + '  (' + mode + ')')
  } catch (e) { fail++; console.error('  ! ' + rel + ' 失败：' + e.message) }
}
console.log('\n合计 ' + mb(srcTotal) + ' → ' + mb(dstTotal) + '（省 ' + (100 - dstTotal / srcTotal * 100).toFixed(1) + '%）· 成功 ' + ok + ' · 失败 ' + fail)
process.exit(fail === 0 ? 0 : 1)

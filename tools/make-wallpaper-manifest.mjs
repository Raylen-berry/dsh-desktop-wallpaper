// 生成 wallpapers.manifest.json（开发/发版脚本，不进 npm 包）
//
// 用途：把底图从 git 里挪到 GitHub Release 资产之后，仓库里只留这份**清单**：
// 每张图的相对路径、字节数、sha256，以及它对应的 Release 资产名。
//   · 插件 host 侧「下载底图」用它逐个拉取并校验（见 index.js 的取图路由）
//   · tools/fetch-wallpapers.mjs 用它做命令行下载（无界面/无 agent 也能用）
// 图变了就重跑本脚本（`node tools/make-wallpaper-manifest.mjs`），提交新的清单。
//
// 资产命名：`w<两位序号><真实扩展名>`（如 w03.png）。**纯 ASCII** —— Release 资产名里带中文
// 在部分代理/客户端下会被二次编码，踩过一次太麻烦；映射关系由清单负责，不需要人肉猜。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const WALL = path.join(ROOT, 'wallpapers')
const OUT = path.join(ROOT, 'wallpapers.manifest.json')
const TAG = process.env.WALLPAPER_RELEASE_TAG || 'wallpapers-v1'
const REPO = 'Raylen-berry/dsh-desktop-wallpaper'

if (!fs.existsSync(WALL)) { console.error('没有 wallpapers/ 目录：' + WALL); process.exit(1) }

const items = []
let idx = 0
for (const cat of fs.readdirSync(WALL).sort()) {
  const catDir = path.join(WALL, cat)
  if (!fs.statSync(catDir).isDirectory()) continue
  for (const f of fs.readdirSync(catDir).sort()) {
    const p = path.join(catDir, f)
    if (!fs.statSync(p).isFile()) continue
    const buf = fs.readFileSync(p)
    idx++
    items.push({
      asset: 'w' + String(idx).padStart(2, '0') + path.extname(f).toLowerCase(),
      path: cat + '/' + f,
      bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    })
  }
}

const manifest = {
  format: 'dsh-bg-atelier-wallpapers/1',
  generatedAt: new Date().toISOString(),
  release: { tag: TAG, repo: REPO, base: 'https://github.com/' + REPO + '/releases/download/' + TAG },
  total: items.length,
  totalBytes: items.reduce((s, i) => s + i.bytes, 0),
  items,
}
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2), 'utf8')
console.log('已写出 ' + OUT)
console.log('  ' + manifest.total + ' 张 · 合计 ' + (manifest.totalBytes / 1048576).toFixed(1) + ' MB')
console.log('  资产基址 ' + manifest.release.base)
for (const i of items.slice(0, 3)) console.log('    ' + i.asset + '  ← ' + i.path + '  (' + (i.bytes / 1048576).toFixed(1) + ' MB)')
if (items.length > 3) console.log('    …其余 ' + (items.length - 3) + ' 张见清单')

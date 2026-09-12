// 命令行取图（无界面 / 无 agent 也能用）：node tools/fetch-wallpapers.mjs [--dir <插件目录>] [--check] [--manifest <文件>]
//
// 与 host 半的「下载底图」按钮走**同一份实现**（../fetch-wallpapers.js），所以两边行为一致。
// 换机器的典型流程（精简克隆之后）：
//   git clone --depth 1 --filter=blob:none --sparse <repo> <dir>
//   cd <dir> && git sparse-checkout set --no-cone '/*' '!/wallpapers/'
//   node tools/fetch-wallpapers.mjs          # 从 Release 资产把 19 张图取回来（可重入）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWallpapers, verifyLocal, readManifest, PLUGIN_DIR } from '../fetch-wallpapers.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const dir = val('--dir') || PLUGIN_DIR

if (args.includes('--check')) {
  const v = verifyLocal(dir)
  if (!v.total) { console.error('清单读不了：' + v.reason); process.exit(1) }
  console.log('本机底图完整性：' + (v.ok ? '全部 ' + v.total + ' 张都在且校验通过 ✓' : '缺 ' + v.missing.length + ' 张、损坏 ' + v.bad.length + ' 张（共 ' + v.total + '）'))
  for (const p of v.missing.slice(0, 5)) console.log('  缺 ' + p)
  for (const p of v.bad.slice(0, 5)) console.log('  损坏 ' + p)
  if (!v.ok) console.log('跑 `node tools/fetch-wallpapers.mjs` 补齐（已存在且校验通过的会跳过）。')
  process.exit(v.ok ? 0 : 1)
}

let manifest
try { manifest = readManifest(dir) } catch (e) { console.error('读不了清单：' + e.message); process.exit(1) }
console.log('底图 ' + manifest.total + ' 张 · 合计 ' + (manifest.totalBytes / 1048576).toFixed(1) + ' MB')
console.log('来源 ' + manifest.release.base)
console.log('目标 ' + path.join(dir, 'wallpapers'))
const started = Date.now()
let lastLine = 0
const result = await fetchWallpapers({
  pluginDir: dir,
  manifest,
  onProgress: (p) => {
    // 每 5% 或每张失败/完成时打一行，避免 19 行刷屏
    const pct = Math.round((p.done / p.total) * 100)
    if (pct >= lastLine + 5 || p.done === p.total || p.state === 'bad') {
      lastLine = pct
      const mb = (p.bytes / 1048576).toFixed(1)
      console.log('  ' + String(pct).padStart(3) + '%  ' + p.done + '/' + p.total + '  已下 ' + p.downloaded + ' 跳过 ' + p.skipped + ' 失败 ' + p.failed + '  (' + mb + ' MB)')
    }
  },
})
console.log('')
if (result.ok) {
  console.log('完成：下载 ' + result.downloaded + ' 张（' + (result.bytes / 1048576).toFixed(1) + ' MB）· 跳过已存在 ' + result.skipped + ' 张 · 用时 ' + ((Date.now() - started) / 1000).toFixed(1) + 's')
  const v = verifyLocal(dir)
  console.log('复检：' + (v.ok ? '19 张全部校验通过 ✓' : '仍缺 ' + v.missing.length + ' 张 / 损坏 ' + v.bad.length + ' 张'))
} else {
  console.error('失败 ' + result.failed + ' 张（其余已就绪，重跑只会补缺的）：')
  for (const e of result.errors) console.error('  ' + e.asset + '  ' + e.path + ' → ' + e.error)
}
process.exit(result.ok ? 0 : 1)

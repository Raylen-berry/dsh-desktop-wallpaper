// 把「同一份内容、两个文件名」的重复底图合成**硬链接**：两个名字都还在，磁盘只存一份字节。
//
// 为什么是硬链接而不是删文件：
//   index.js 的图库列表是**实时扫盘**（fs.readdir，见 scanTypeDir/listTypeDirs），
//   wallpapers/ 下每个受支持的文件都会变成设置页里的一张图。删掉重复名会**改变用户看到的列表**，
//   而硬链接让两个名字都继续存在、内容一模一样 ⇒ 列表、URL、已有设置里的引用全都不变。
//
// 为什么文件操作走 PowerShell 而不是 node:fs（实测踩过，别改回去）：
//   在 win32 / 这个卷上，node:fs 的 linkSync+statSync 组合会**原生崩溃**（exit 0xC0000409，
//   STATUS_STACK_BUFFER_OVERRUN，进程直接消失、不打异常栈）。同一步用 PowerShell 的
//   `New-Item -ItemType HardLink` 走 CreateHardLinkW，稳定成功（fsutil hardlink list 复核 nlink=2）。
//   所以本工具只把**扫描/哈希/判定**留在 node（那些 fs 调用是好的），把**建链**交给 PowerShell。
//
// 判定重复的**唯一依据是 sha256**，不是文件名；建链前还会核对大小。非同内容一律拒绝执行。
//
// 用法：
//   node tools/dedup-hardlink.mjs --dry-run      # 只报告重复，不动盘
//   node tools/dedup-hardlink.mjs                # 真建链（默认）
//   node tools/dedup-hardlink.mjs --pairs        # 只打印磁盘上所有同 sha256 的组
//
// 回退：删掉新建的那个名字，再从备份拷回来。备份由调用方先做（本工具不负责备份），
//   典型：Copy-Item <keep> <备份目录>\<名字>.bak，回退时 Copy-Item 回来即可。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WALL = path.join(ROOT, 'wallpapers')
const MIME_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])

const isImage = (name) => MIME_EXT.has(path.extname(name).toLowerCase())

/**
 * 两个路径是否指向**同一份数据**（同卷 + 同 inode）。
 * 这是判定"硬链接去重成功"的唯一正确口径：内容 sha256 相同只说明"内容一样"，
 * 只有同 inode 才能证明"磁盘上只存了一份"。去重后 findDuplicateGroups 仍会报这两个名字
 * ——那是**预期的**（一份内容、多名称引用），不矛盾。
 */
export function sameFile(a, b) {
  const sa = fs.statSync(a), sb = fs.statSync(b)
  return sa.dev === sb.dev && sa.ino === sb.ino
}

function sha256(file) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024)   // 分块读，60MB 的图也不整块进内存
    let read
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, read))
  } finally { fs.closeSync(fd) }
  return hash.digest('hex')
}

/** 扫出 wallpapers/<类型>/<文件> 的所有图片（不递归更深层，和 index.js 的两级模型一致）。 */
export function scanImages(dir = WALL) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const cat of fs.readdirSync(dir).sort()) {
    const catDir = path.join(dir, cat)
    let st
    try { st = fs.statSync(catDir) } catch { continue }
    if (!st.isDirectory()) continue
    for (const name of fs.readdirSync(catDir).sort()) {
      const p = path.join(catDir, name)
      let fst
      try { fst = fs.statSync(p) } catch { continue }
      if (!fst.isFile() || !isImage(name)) continue
      out.push({ cat, name, path: p, size: fst.size, rel: cat + '/' + name })
    }
  }
  return out
}

/** 按 (size, sha256) 分组，只返回出现 2 次以上的组。size 唯一的先排除，省哈希时间。 */
export function findDuplicateGroups(dir = WALL) {
  const bySize = new Map()
  for (const f of scanImages(dir)) {
    if (!bySize.has(f.size)) bySize.set(f.size, [])
    bySize.get(f.size).push(f)
  }
  const byHash = new Map()
  for (const [, group] of bySize) {
    if (group.length < 2) continue
    for (const f of group) {
      const h = sha256(f.path)
      if (!byHash.has(h)) byHash.set(h, [])
      byHash.get(h).push(f)
    }
  }
  return [...byHash.entries()].filter(([, g]) => g.length > 1).map(([hash, group]) => ({ hash, group }))
}

// ---- 用 PowerShell 建硬链接 ----------------------------------------------------------
// 为什么不用 node:fs 的 linkSync：实测在 win32/本卷上 linkSync+statSync 组合会原生崩溃
// （exit 0xC0000409 STATUS_STACK_BUFFER_OVERRUN，进程直接消失、没有异常栈）。走
// PowerShell 的 New-Item -ItemType HardLink（CreateHardLinkW）则稳定成功。
//
// 拼脚本的安全做法：所有路径都用**绝对路径**、包在单引号里，并把路径里的 `'` 双写转义
// （PowerShell 单引号字符串里 '' 表示一个字面单引号）⇒ 文件名再怪也注入不了命令。
// 另外再做一次自校验：建完必须真的存在。
// 返回 { ok, out }；ok=false 时 out 是 PowerShell 的报错文本。
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'"

function psHardLink(keep, dup) {
  const keepAbs = path.resolve(keep)
  const dupAbs = path.resolve(dup)
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$keep = ' + psQuote(keepAbs),
    '$dup  = ' + psQuote(dupAbs),
    'if (-not (Test-Path -LiteralPath $keep)) { throw "保留的那份不存在: $keep" }',
    'if (-not (Test-Path -LiteralPath $dup))  { throw "要建链的名字不存在: $dup" }',
    'Remove-Item -LiteralPath $dup -Force',
    'New-Item -ItemType HardLink -Path $dup -Target $keep -ErrorAction Stop | Out-Null',
    'if (-not (Test-Path -LiteralPath $dup)) { throw "建链后名字不存在: $dup" }',
    'Write-Output "OK"',
  ].join('; ')
  const s = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  if (s.error) return { ok: false, out: '起不了 pwsh：' + s.error.message }
  const out = ((s.stdout || '') + (s.stderr || '')).trim()
  if (s.status !== 0) return { ok: false, out }
  return { ok: true, out }
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const files = scanImages()
  console.log('扫描 ' + WALL)
  console.log('图片 ' + files.length + ' 个 · 条目求和 ' + (files.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(2) + ' MiB')

  const groups = findDuplicateGroups()
  if (!groups.length) { console.log('\n没有同 sha256 的重复图片 —— 无需去重。'); return }
  if (args.includes('--pairs')) {
    for (const g of groups) console.log('\n  sha256 ' + g.hash.slice(0, 16) + '…\n' + g.group.map((f) => '    ' + f.rel).join('\n'))
    return
  }

  let reclaimed = 0, made = 0
  for (const g of groups) {
    const keep = g.group[0]                       // 保留组内第一个名字，其余建成它的硬链接
    console.log('\n=== sha256 ' + g.hash.slice(0, 16) + '… · ' + g.group.length + ' 个名字 ===')
    for (const f of g.group) console.log('    ' + f.rel + '  ' + f.size + ' B')
    for (const dup of g.group.slice(1)) {
      // 已经同 inode ⇒ 早已去重过，幂等跳过（重跑本工具必须无副作用）
      let same = false
      try { same = sameFile(keep.path, dup.path) } catch { /* 见下 */ }
      if (same) { console.log('    · ' + dup.rel + ' 已经是同一 inode，跳过'); continue }
      if (dup.size !== keep.size) { console.log('    ✗ ' + dup.rel + ' 大小不符，跳过'); continue }
      if (dryRun) { console.log('    → 会建链 ' + dup.rel + ' ⇒ ' + keep.rel + '（可回收 ' + (dup.size / 1048576).toFixed(2) + ' MiB）'); reclaimed += dup.size; continue }
      const r = psHardLink(keep.path, dup.path)
      if (!r.ok) throw new Error('建硬链接失败：' + dup.rel + '\n' + r.out + '\n（原文件可能已被删名，请从备份 Copy-Item 回来）')
      if (!sameFile(keep.path, dup.path)) throw new Error('建链后仍不同 inode：' + dup.rel)
      if (sha256(dup.path) !== g.hash) throw new Error('建链后内容不符：' + dup.rel)
      made++; reclaimed += dup.size
      console.log('    ✓ 已建链 ' + dup.rel + ' ⇒ ' + keep.rel)
    }
  }
  console.log('\n' + (dryRun ? '（dry-run，未改动磁盘）会回收 ' : '建链 ' + made + ' 个 · 回收 ') + (reclaimed / 1048576).toFixed(2) + ' MiB')
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main()

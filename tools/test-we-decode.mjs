#!/usr/bin/env node
// tools/test-we-decode.mjs —— WE 解包链路的离线断言（不需要真 .pkg：全部现场合成）
//
// 覆盖三块最容易"改坏了没人发现"的逻辑：
//   ① LZ4 块解码（字面量 + 带重叠的匹配复制）
//   ② DXT1 / DXT5 解块
//   ③ PKGV00200 容器表 + .tex 头/容器解析（含内嵌 PNG 直通）
// 真机素材（100MB 的 scene.pkg）不进仓库，所以这里用合成字节把协议钉住。
import { lz4Decode, decodeDXT, readTex, decodeTex } from '../we/tex.js'
import { readPkg } from '../we/pkg.js'

let pass = 0, fail = 0
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected)
  if (a === b) { pass++; console.log(`PASS ${what}`) }
  else { fail++; console.log(`FAIL ${what}\n   got      ${a}\n   expected ${b}`) }
}

// ---------------------------------------------------------------- ① LZ4 ----
// 只有字面量: token=0x30 (lit=3, match=0) + "ABC"
eq([...lz4Decode(Buffer.from([0x30, 0x41, 0x42, 0x43]), 3)], [65, 66, 67], 'lz4: 纯字面量块')
// 字面量 + 匹配 + **重叠复制**: 0x40 (lit=4, match=4) "ABCD" offset=4 -> ABCDABCD
eq(lz4Decode(Buffer.from([0x40, 0x41, 0x42, 0x43, 0x44, 0x04, 0x00]), 8).toString('latin1'), 'ABCDABCD', 'lz4: 匹配段重叠复制')
// 长度扩展字节: lit=15 -> 读 0xFF 继续累加
{
  const lit = Buffer.alloc(15 + 255 + 1, 0x5a)
  const block = Buffer.concat([Buffer.from([0xf0, 0xff, 0x01]), lit])
  const out = lz4Decode(block, lit.length)
  eq(out.length === lit.length && out.every(b => b === 0x5a), true, 'lz4: 字面量长度扩展')
}
// 长度不符要报错（防止"悄悄截断"）
{
  let threw = false
  try { lz4Decode(Buffer.from([0x30, 1, 2, 3]), 99) } catch { threw = true }
  eq(threw, true, 'lz4: 解出长度与声明不符时报错')
}

// ---------------------------------------------------------------- ② DXT ----
// 单块 4x4 DXT1: c0=c1=0xF800(纯红) 索引全 0 -> 整块红、不透明
{
  const blk = Buffer.alloc(8)
  blk.writeUInt16LE(0xf800, 0); blk.writeUInt16LE(0xf800, 2); blk.writeUInt32LE(0, 4)
  const px = decodeDXT(4, 4, blk, 'DXT1')
  eq([px[0], px[1], px[2], px[3]], [255, 0, 0, 255], 'dxt1: 纯红块 (c0==c1)')
  eq(px.length, 4 * 4 * 4, 'dxt1: 输出 RGBA 长度')
}
// 单块 4x4 DXT5: 颜色绿(0x07E0)，alpha 端点 a0=255,a1=0 且索引全 0 -> alpha 255
{
  const blk = Buffer.alloc(16)
  blk[0] = 255; blk[1] = 0
  blk.writeUInt16LE(0x07e0, 8); blk.writeUInt16LE(0x07e0, 10); blk.writeUInt32LE(0, 12)
  const px = decodeDXT(4, 4, blk, 'DXT5')
  eq([px[0], px[1], px[2], px[3]], [0, 255, 0, 255], 'dxt5: 纯绿块 + alpha 端点表')
}
// DXT5 alpha 端点表: a0>a1 -> 索引 1 = a1（设 a1=0 即全透明）
{
  const blk = Buffer.alloc(16)
  blk[0] = 255; blk[1] = 0
  for (let k = 0; k < 6; k++) blk[2 + k] = 0x01   // 每像素 3 bit = 001 -> 索引 1
  blk.writeUInt16LE(0xffff, 8); blk.writeUInt16LE(0xffff, 10); blk.writeUInt32LE(0, 12)
  const px = decodeDXT(4, 4, blk, 'DXT5')
  eq(px[3], 0, 'dxt5: a0>a1 时索引 1 = a1(0) 全透明')
}
// DXT5 alpha 端点表: a0<=a1 -> 索引 6/7 固定为 0 / 255
{
  const blk = Buffer.alloc(16)
  blk[0] = 0; blk[1] = 255
  for (let k = 0; k < 6; k++) blk[2 + k] = 0x06   // 每像素 3 bit = 110 -> 索引 6
  blk.writeUInt16LE(0xffff, 8); blk.writeUInt16LE(0xffff, 10); blk.writeUInt32LE(0, 12)
  const px = decodeDXT(4, 4, blk, 'DXT5')
  eq(px[3], 0, 'dxt5: a0<=a1 时索引 6 = 0')
}

// --------------------------------------------------- ③ PKGV / .tex reader ----
// 合成一个 PKGV00200: 1 个条目 "hello.txt" = "hi"
{
  const magic = Buffer.from('PKGV0020', 'ascii')
  const data = Buffer.from('hi', 'ascii')
  const head = Buffer.alloc(4 + magic.length + 4)
  head.writeUInt32LE(magic.length, 0); magic.copy(head, 4)
  head.writeUInt32LE(1, 4 + magic.length)
  const entry = Buffer.alloc(4)
  const p = Buffer.from('hello.txt', 'ascii')
  const e = Buffer.alloc(4 + p.length + 8)
  e.writeUInt32LE(p.length, 0); p.copy(e, 4)
  e.writeUInt32LE(0, 4 + p.length)                 // offset 相对数据段
  e.writeUInt32LE(data.length, 8 + p.length)
  const pkg = readPkg(Buffer.concat([head, e, data]))
  eq(pkg.magic, 'PKGV0020', 'pkg: magic 按长度前缀读（9 字符假象不影响）')
  eq(pkg.entries.length, 1, 'pkg: 条目数')
  eq(pkg.read('hello.txt').toString('ascii'), 'hi', 'pkg: 按路径取数据')
  eq(pkg.read('nope.txt'), null, 'pkg: 取不存在的条目返回 null')
}
// 合成一个 .tex: TEXB0003 + ImageFormat=13(FIF_PNG) + 1 mip，内容就是内嵌 PNG 字节
{
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64')
  const chunks = []
  const push = (b) => chunks.push(b)
  push(Buffer.from('TEXV0005\0TEXI0001\0', 'latin1'))
  const header = Buffer.alloc(28)
  header.writeInt32LE(0, 0)        // format = RGBA8888
  header.writeInt32LE(2, 4)        // flags
  header.writeInt32LE(1, 8); header.writeInt32LE(1, 12)    // texture 1x1
  header.writeInt32LE(1, 16); header.writeInt32LE(1, 20)   // image 1x1
  header.writeInt32LE(0, 24)
  push(header)
  push(Buffer.from('TEXB0003\0', 'latin1'))
  const c = Buffer.alloc(8)
  c.writeInt32LE(1, 0)             // imageCount
  c.writeInt32LE(13, 4)            // ImageFormat = FIF_PNG
  push(c)
  const mip = Buffer.alloc(4 + 20)
  mip.writeInt32LE(1, 0)           // mipmapCount
  mip.writeInt32LE(1, 4); mip.writeInt32LE(1, 8)   // w,h
  mip.writeInt32LE(0, 12)          // isLZ4 = false
  mip.writeInt32LE(0, 16)          // decompressedBytes
  mip.writeInt32LE(PNG_1x1.length, 20)
  push(mip)
  push(PNG_1x1)
  const tex = readTex(Buffer.concat(chunks))
  eq(tex.container, 'TEXB0003', 'tex: 容器魔数')
  eq(tex.imageFormat, 13, 'tex: ImageFormat=FIF_PNG')
  eq(tex.header.imgW, 1, 'tex: 头字段 imgW')
  const dec = decodeTex(tex)
  eq(dec.png.equals(PNG_1x1), true, 'tex: PNG 直通不改字节')
  eq([dec.width, dec.height], [1, 1], 'tex: mip 尺寸')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} WE 解包链路（LZ4 / DXT / PKGV / tex）：${pass} 通过, ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)

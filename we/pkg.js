// PKGV00200 容器读取（scene.pkg / tex.pkg 同一格式，WE 私有但结构简单）
//
// 布局（实测 + 对齐 RePKG 的 PackageReader）:
//   [u32 magicLen]["PKGV0020"] [u32 entryCount] entry*: [u32 pathLen][path][u32 offset][u32 length]
//   offset 相对 **数据段起点**（表尾）。
// 坑: 文件里看着像 9 字符 "PKGV00200"，其实第 9 个 '0'(0x30) 是紧随其后的 u32 条目数
//     (0x130=304) 的低字节 —— 按 9 字节魔数读会把后面的字段整体错位一位。
// 数据段本身不压缩（压缩在 .tex 内部，见 we/tex.js）。
import fs from "node:fs";

export function readPkg(buf) {
  let o = 0;
  const u32 = () => { const v = buf.readUInt32LE(o); o += 4; return v };
  const magicLen = u32();
  const magic = buf.slice(o, o + magicLen).toString("ascii"); o += magicLen;
  if (!magic.startsWith("PKGV")) throw new Error(`not a PKGV package: ${JSON.stringify(magic)}`);
  const count = u32();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const n = u32();
    const p = buf.slice(o, o + n).toString("utf8"); o += n;
    const offset = u32();
    const length = u32();
    entries.push({ p, offset, length });
  }
  const dataStart = o;
  const byPath = new Map(entries.map((e) => [e.p, e]));
  return {
    magic,
    entries,
    dataStart,
    has: (p) => byPath.has(p),
    /** 条目原始字节（未解压，.tex 内部自己带压缩标记） */
    read: (p) => {
      const e = byPath.get(p);
      if (!e) return null;
      return buf.slice(dataStart + e.offset, dataStart + e.offset + e.length);
    },
    readJson: (p) => {
      const b = byPath.get(p) ? buf.slice(dataStart + byPath.get(p).offset, dataStart + byPath.get(p).offset + byPath.get(p).length) : null;
      return b ? JSON.parse(b.toString("utf8")) : null;
    },
  };
}

export function readPkgFile(filePath) {
  return readPkg(fs.readFileSync(filePath));
}

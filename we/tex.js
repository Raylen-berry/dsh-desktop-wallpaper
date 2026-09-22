// WE .tex 解码（Node 实现；格式对齐 RePKG 的 TexReader/TexImageReader/TexMipmapDecompressor）
//
//   9 字节 NUL 结尾串 "TEXV0005" / "TEXI0001"
//   i32 format,flags,texW,texH,imgW,imgH,unk        ← format 见 TexFormat
//   9 字节串容器魔数 "TEXB000x"
//   i32 imageCount；TEXB0003/0004 再跟 i32 ImageFormat（FreeImage 枚举，-1=UNKNOWN 走 header.format，13=FIF_PNG）
//   每个 image: i32 mipmapCount
//     每个 mipmap(V2/V3): i32 w,h,isLZ4,decompressedBytes,byteCount + byteCount 字节
//   LZ4 是 **块格式**（K4os LZ4Codec.Decode），不是 frame —— 所以只能自己写解码器。
//
// 实践中 scene.pkg 里的大图会把 mip 直接存成 PNG（ImageFormat=13，此时 LZ4 标记为 0），
// 小图（脸上的眼睛/睫毛之类）才走 RGBA8888/DXT + LZ4。
export const TexFormat = { RGBA8888: 0, DXT5: 4, DXT3: 6, DXT1: 7, RG88: 8, R8: 9 };
const FREEIMAGE_PNG = 13;

// ---------------------------------------------------------------- LZ4 block --
export function lz4Decode(src, destLen) {
  const dst = Buffer.alloc(destLen);
  let s = 0, d = 0;
  while (s < src.length) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b } while (b === 255) }
    if (lit) { src.copy(dst, d, s, s + lit); s += lit; d += lit }
    if (s >= src.length) break;
    const offset = src[s] | (src[s + 1] << 8); s += 2;
    let len = token & 0x0f;
    if (len === 15) { let b; do { b = src[s++]; len += b } while (b === 255) }
    len += 4;
    let mp = d - offset;
    if (mp < 0) throw new Error("lz4: match offset before output start");
    for (let i = 0; i < len; i++) dst[d++] = dst[mp++];   // 必须逐字节（允许重叠）
  }
  if (d !== destLen) throw new Error(`lz4: decoded ${d} bytes, expected ${destLen}`);
  return dst;
}

// ------------------------------------------------------------- DXT / BC1-3 --
function c565(v) {
  return [
    Math.round(((v >> 11) & 31) * 255 / 31),
    Math.round(((v >> 5) & 63) * 255 / 63),
    Math.round((v & 31) * 255 / 31),
  ];
}

export function decodeDXT(width, height, data, kind) {
  const out = Buffer.alloc(width * height * 4);
  const bw = Math.max(1, Math.ceil(width / 4)), bh = Math.max(1, Math.ceil(height / 4));
  const blockBytes = kind === "DXT1" ? 8 : 16;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const base = (by * bw + bx) * blockBytes;
      const alphaBlock = kind === "DXT1" ? null : data.slice(base, base + 8);
      const colorAt = kind === "DXT1" ? base : base + 8;
      const c0 = data.readUInt16LE(colorAt), c1 = data.readUInt16LE(colorAt + 2);
      const idx = data.readUInt32LE(colorAt + 4);
      const p0 = c565(c0), p1 = c565(c1);
      const pal = [p0, p1, [0, 0, 0], [0, 0, 0]];
      if (kind === "DXT1" && c0 <= c1) {
        pal[2] = [(p0[0] + p1[0]) >> 1, (p0[1] + p1[1]) >> 1, (p0[2] + p1[2]) >> 1];
      } else {
        pal[2] = [(2 * p0[0] + p1[0]) / 3 | 0, (2 * p0[1] + p1[1]) / 3 | 0, (2 * p0[2] + p1[2]) / 3 | 0];
        pal[3] = [(p0[0] + 2 * p1[0]) / 3 | 0, (p0[1] + 2 * p1[1]) / 3 | 0, (p0[2] + 2 * p1[2]) / 3 | 0];
      }
      // DXT5 的 alpha 插值表按端点大小分 8 档 / 6+0+255 档
      let ap = null;
      if (kind === "DXT5") {
        const a0 = alphaBlock[0], a1 = alphaBlock[1];
        let bits = 0n;
        for (let k = 0; k < 6; k++) bits |= BigInt(alphaBlock[2 + k]) << BigInt(8 * k);
        ap = [a0, a1];
        if (a0 > a1) for (let k = 1; k <= 6; k++) ap.push(Math.round(((7 - k) * a0 + k * a1) / 7));
        else {
          for (let k = 1; k <= 4; k++) ap.push(Math.round(((5 - k) * a0 + k * a1) / 5));
          ap.push(0, 255);
        }
        alphaBlock._bits = bits;
      }
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const px = bx * 4 + x, py = by * 4 + y;
          if (px >= width || py >= height) continue;
          const i = y * 4 + x;
          const ci = (idx >> (2 * i)) & 3;
          let a = 255;
          if (kind === "DXT3") a = ((alphaBlock[i >> 1] >> ((i & 1) * 4)) & 0x0f) * 17;
          else if (kind === "DXT5") a = ap[Number((alphaBlock._bits >> BigInt(3 * i)) & 7n)];
          else if (c0 <= c1 && ci === 3) a = 0;
          const o = (py * width + px) * 4;
          out[o] = pal[ci][0]; out[o + 1] = pal[ci][1]; out[o + 2] = pal[ci][2]; out[o + 3] = a;
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ reader --
export function readTex(buf) {
  let o = 0;
  const i32 = () => { const v = buf.readInt32LE(o); o += 4; return v };
  const nstr = () => { const e = buf.indexOf(0, o); const s = buf.slice(o, e).toString("latin1"); o = e + 1; return s };
  const magic1 = nstr(), magic2 = nstr();
  if (magic1 !== "TEXV0005" || magic2 !== "TEXI0001") throw new Error(`not a WE tex: ${magic1}/${magic2}`);
  const header = { format: i32(), flags: i32(), texW: i32(), texH: i32(), imgW: i32(), imgH: i32(), unk: i32() };
  const container = nstr();
  const imageCount = i32();
  const version = Number(container.slice(4, 5));
  let imageFormat = -1;
  if (container === "TEXB0003" || container === "TEXB0004") imageFormat = i32();
  const images = [];
  for (let i = 0; i < imageCount; i++) {
    const mipmapCount = i32();
    const mipmaps = [];
    for (let m = 0; m < mipmapCount; m++) {
      const width = i32(), height = i32();
      let isLZ4 = false, decompressed = 0, bytes;
      if (version === 1) { const n = i32(); bytes = buf.slice(o, o + n); o += n; }
      else {
        isLZ4 = i32() === 1;
        decompressed = i32();
        const n = i32();
        bytes = buf.slice(o, o + n); o += n;
      }
      mipmaps.push({ width, height, isLZ4, decompressed, bytes });
    }
    images.push({ mipmaps });
  }
  return { header, container, imageFormat, images };
}

/** 解码某张 mip 到 RGBA（或返回内嵌 PNG 原始字节）。默认 mip0。 */
export function decodeTex(tex, mipIndex = 0) {
  const mip = tex.images[0].mipmaps[mipIndex];
  if (!mip) throw new Error(`no mip ${mipIndex}`);
  let bytes = mip.bytes;
  if (mip.isLZ4) bytes = lz4Decode(bytes, mip.decompressed);
  if (tex.imageFormat === FREEIMAGE_PNG) {
    return { png: bytes, width: mip.width, height: mip.height };
  }
  const fmt = tex.header.format;
  const args = [mip.width, mip.height, bytes];
  if (fmt === TexFormat.RGBA8888) return { data: bytes, width: mip.width, height: mip.height };
  if (fmt === TexFormat.DXT5) return { data: decodeDXT(...args, "DXT5"), width: mip.width, height: mip.height };
  if (fmt === TexFormat.DXT3) return { data: decodeDXT(...args, "DXT3"), width: mip.width, height: mip.height };
  if (fmt === TexFormat.DXT1) return { data: decodeDXT(...args, "DXT1"), width: mip.width, height: mip.height };
  throw new Error(`unsupported tex format ${fmt}`);
}

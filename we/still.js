// scene.pkg → 高清静态图（"解包出图"这一步的落地实现）
//
// 为什么需要它: scene 类的动效本体封在 scene.pkg 里，WE 只额外给一张 192×192 的
// preview.gif —— 铺满 4K 屏就是 7~13 倍放大。包里其实躺着**全分辨率**素材
// (本机那张是 6720×3776 的贴图)，所以这里把包解开、按 scene.json 的位置关系合成一张
// 静态图，再由客户端当背景铺 (动效换成静态，是明确的取舍)。
//
// 已知近似（都不是 bug，是"不重写 WE 渲染器"的边界，写清楚免得下次当玄学）:
//   ① 相机: 用 scene.json 的 orthogonalprojection 推不出屏幕框，实测取"整屏覆盖层"
//      (白 / 图层 1，尺寸正好 16:9) 的矩形当可见框 —— 与所有图层的并集几乎重合。
//   ② 原点: WE 的 origin 是图层**中心**（按左上角解释会把整场景错开半个图）。
//   ③ 骨骼: 挂在 puppet 骨骼上的层 (attachment 字段) 拿不到骨骼矩阵，用最近的
//      非 attachment 祖先当骨骼坐标系近似 —— 头发/脸能贴上，但不保证与 WE 逐像素一致。
//   ④ 特效 (blur/水波/音频响应/脚本动画) 不渲染；alpha/brightness 等属性也不做混合。
import { readPkgFile } from "./pkg.js";
import { readTex, decodeTex } from "./tex.js";

const num = (s, i, d = 0) => {
  const parts = String(s ?? "").trim().split(/\s+/);
  const v = parseFloat(parts[i]);
  return isFinite(v) ? v : d;
};

/** 场景里"整屏覆盖层"的候选名字（尺寸正好 16:9，用来定可见框） */
const FULLSCREEN_NAMES = ["白", "图层 1"];

export async function composeStill({ pkgPath, sharp, quality = 92 }) {
  if (!sharp) throw new Error("sharp unavailable: 解 scene.pkg 出图依赖 sharp");
  const pkg = readPkgFile(pkgPath);
  const scene = pkg.readJson("scene.json");
  if (!scene || !Array.isArray(scene.objects)) throw new Error("scene.json 里没有 objects");

  // ---- 贴图缓存: 同一张贴图会被多个图层引用（脸/头发分件共用底图） ----
  const texCache = new Map();
  function textureFor(ob) {
    if (!ob.image) return null;
    const model = pkg.readJson(ob.image);
    const mat = model && model.material ? pkg.readJson(model.material) : null;
    const name = mat && mat.passes && mat.passes[0] && mat.passes[0].textures && mat.passes[0].textures[0];
    if (!name) return null;
    if (texCache.has(name)) return texCache.get(name);
    let res = null;
    try {
      const raw = pkg.read("materials/" + name + ".tex");
      if (raw) {
        const tex = readTex(raw);
        res = { ...decodeTex(tex), name, format: tex.header.format };
      }
    } catch (e) {
      console.error(`[dsh-bg-atelier] we still: 贴图解不出 ${name}: ${e && e.message}`);
    }
    texCache.set(name, res);
    return res;
  }

  // ---- 世界坐标: 父链相乘；attachment 层挂到最近的非 attachment 祖先（见文件头 ③） ----
  const byId = new Map(scene.objects.map((x) => [x.id, x]));
  function worldOf(ob) {
    const scale = num(ob.scale, 0, 1);
    const ox = num(ob.origin, 0), oy = num(ob.origin, 1);
    let parentOb = ob.parent ? byId.get(ob.parent) : null;
    if (ob.attachment) {
      let anc = parentOb;
      while (anc && anc.attachment) anc = byId.get(anc.parent);
      parentOb = anc || null;
    }
    if (parentOb) {
      const p = worldOf(parentOb);
      return { x: p.x + p.scale * ox, y: p.y + p.scale * oy, scale: p.scale * scale };
    }
    return { x: ox, y: oy, scale };
  }

  const placed = [];
  for (const ob of scene.objects) {
    if (!ob.image) continue;
    const vis = ob.visible;
    if (vis && typeof vis === "object" && vis.value === false) continue;
    const tex = textureFor(ob);
    if (!tex) continue;                              // 音频响应一类空壳没有贴图，天然被跳过
    const w = worldOf(ob);
    const sw = num(ob.scale, 0, 1), sh = num(ob.scale, 1, sw || 1);
    const pw = Math.max(1, Math.round(num(ob.size, 0) * w.scale));
    const ph = Math.max(1, Math.round(num(ob.size, 1) * w.scale * (sw ? sh / sw : 1)));
    placed.push({ name: ob.name, tex, pw, ph, cx: w.x, cy: w.y });
  }
  if (!placed.length) throw new Error("没有可用的图层");

  // ---- 可见框: 整屏覆盖层的矩形；没有就退回所有图层的并集 ----
  const full = scene.objects.filter((x) => FULLSCREEN_NAMES.includes(x.name))[0];
  let W, H, offX, offY;
  if (full) {
    const fw = worldOf(full);
    W = Math.round(num(full.size, 0) * fw.scale);
    H = Math.round(num(full.size, 1) * fw.scale);
    offX = Math.round(fw.x - W / 2);
    offY = Math.round(fw.y - H / 2);
  } else {
    offX = Math.floor(Math.min(...placed.map((p) => p.cx - p.pw / 2)));
    offY = Math.floor(Math.min(...placed.map((p) => p.cy - p.ph / 2)));
    W = Math.ceil(Math.max(...placed.map((p) => p.cx + p.pw / 2))) - offX;
    H = Math.ceil(Math.max(...placed.map((p) => p.cy + p.ph / 2))) - offY;
  }
  if (!(W > 0) || !(H > 0)) throw new Error(`可见框算出来是 ${W}x${H}`);

  // ---- 合成（图层顺序 = scene.json 数组顺序；sharp 只接受不大于画布的图，先裁交集） ----
  const composites = [];
  for (const p of placed) {
    const left = Math.round(p.cx - p.pw / 2 - offX);
    const top = Math.round(p.cy - p.ph / 2 - offY);
    if (left + p.pw <= 0 || top + p.ph <= 0 || left >= W || top >= H) continue;
    const ix = Math.max(0, left), iy = Math.max(0, top);
    const ix2 = Math.min(W, left + p.pw), iy2 = Math.min(H, top + p.ph);
    if (ix2 <= ix || iy2 <= iy) continue;
    const base = p.tex.png
      ? sharp(p.tex.png)
      : sharp(p.tex.data, { raw: { width: p.tex.width, height: p.tex.height, channels: 4 } });
    const buf = await base
      .resize(p.pw, p.ph, { fit: "fill" })
      .extract({ left: ix - left, top: iy - top, width: ix2 - ix, height: iy2 - iy })
      .png()
      .toBuffer();
    composites.push({ input: buf, left: ix, top: iy });
  }
  if (!composites.length) throw new Error("所有图层都落在可见框外");

  const out = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composites).webp({ quality, effort: 4 }).toBuffer();

  return { buffer: out, width: W, height: H, layers: composites.length, entries: pkg.entries.length };
}

// 库扫描。字段对齐实测 project.json: type/file/preview/title/tags。
// media 路由消费 previewRel（相对 entry.path 的干净相对路径），URL 面无绝对路径。
import fs from "node:fs/promises";
import path from "node:path";

const PREVIEW_NAMES = ["preview.gif", "preview.jpg", "preview.png", "thumbnail.jpg"];

async function firstExisting(dir, names) {
  for (const n of names) {
    const p = path.join(dir, n);
    try { await fs.access(p); return p; } catch { /* next */ }
  }
  return null;
}

async function scanDir(dir, source, out) {
  if (!dir) return;
  let ids = [];
  try { ids = await fs.readdir(dir); } catch { return; }
  for (const id of ids) {
    try {
      const pjPath = path.join(dir, id, "project.json");
      const pj = JSON.parse(await fs.readFile(pjPath, "utf-8"));
      const preview = await firstExisting(path.join(dir, id), PREVIEW_NAMES);
      out.push({
        id,
        source,
        title: pj.title ?? id,
        type: pj.type ?? "unknown",
        file: pj.file ?? null,                          // mp4/html；scene 类封在 .pkg 内, 磁盘不存在
        preview,                                        // 绝对路径（调试用）
        previewRel: preview ? path.relative(path.join(dir, id), preview).replace(/\\/g, "/") : null,
        tags: Array.isArray(pj.tags) ? pj.tags : [],
        schemeColor: pj.general?.properties?.schemecolor?.value ?? null,
        path: path.join(dir, id),
      });
    } catch { /* 无 project.json 或损坏，跳过 */ }
  }
}

export async function scanLibrary(paths) {
  const out = [];
  await Promise.all([
    scanDir(paths.workshopRoot, "workshop", out),
    scanDir(paths.localProjectsDir, "local", out),
  ]);
  const map = new Map();
  for (const e of out) if (!map.has(e.id) || e.source === "local") map.set(e.id, e);
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}

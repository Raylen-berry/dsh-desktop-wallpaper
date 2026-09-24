// 库扫描。字段对齐实测 project.json: type/file/preview/title/tags。
// media 路由消费 previewRel（相对 entry.path 的干净相对路径），URL 面无绝对路径。
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const PREVIEW_NAMES = ["preview.gif", "preview.jpg", "preview.png", "thumbnail.jpg"];

async function firstExisting(dir, names) {
  for (const n of names) {
    const p = path.join(dir, n);
    try { await fs.access(p); return p; } catch { /* next */ }
  }
  return null;
}

async function scanDir(dir, source, out, root = dir, depth = 0) {
  if (!dir) return;
  let ids = [];
  try { ids = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const item of ids) {
    if (!item.isDirectory() || item.isSymbolicLink()) continue;
    const name = item.name;
    const projectDir = path.join(dir, name);
    try {
      const pjPath = path.join(projectDir, "project.json");
      const pj = JSON.parse(await fs.readFile(pjPath, "utf-8"));
      if (!pj || typeof pj !== 'object' || Array.isArray(pj)) continue;
      const rel = path.relative(root, projectDir).replace(/\\/g, '/');
      const id = source === 'local' ? 'local-' + createHash('sha256').update(rel).digest('hex').slice(0, 24) : name;
      const preview = await firstExisting(projectDir, PREVIEW_NAMES);
      out.push({
        id,
        source,
        title: typeof pj.title === 'string' ? pj.title : name,
        type: pj.type ?? "unknown",
        file: pj.file ?? null,                          // mp4/html；scene 类封在 .pkg 内, 磁盘不存在
        preview,                                        // 绝对路径（调试用）
        previewRel: preview ? path.relative(projectDir, preview).replace(/\\/g, "/") : null,
        tags: Array.isArray(pj.tags) ? pj.tags : [],
        schemeColor: pj.general?.properties?.schemecolor?.value ?? null,
        path: projectDir,
      });
    } catch {
      // WE local layout: projects/<group>/<project>/project.json. Stop at
      // project roots and never recursively walk their asset directories.
      if (source === 'local' && depth < 1) await scanDir(projectDir, source, out, root, depth + 1);
    }
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

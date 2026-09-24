// M-A: Wallpaper Engine 路径发现
// 优先级: 注册表 HKCU\Software\Valve\Steam -> libraryfolders.vdf -> 硬编码兜底
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function regQuerySteamPath() {
  return new Promise((resolve) => {
    execFile(
      "reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { encoding: "utf8", windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const m = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
        resolve(m ? m[1].trim().replace(/\\/g, "/") : null);
      }
    );
  });
}

// libraryfolders.vdf 不是 JSON，正则抓 "path" "xxx" 足够稳（实测 WE 库就在这）
function parseLibraryFolders(vdfText) {
  const out = [];
  const re = /"path"\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(vdfText))) out.push(m[1].replace(/\\\\/g, "/"));
  return out;
}

const FALLBACK_ROOTS = [
  "C:/Program Files (x86)/Steam",
  "C:/Program Files/Steam",
  "D:/Steam", "D:/SteamLibrary", "D:/APP/Steam",
  "E:/Steam", "E:/SteamLibrary",
  "F:/Steam", "F:/SteamLibrary",
];

export async function discoverWePaths() {
  const roots = [];

  const regRoot = await regQuerySteamPath();
  if (regRoot) roots.push(regRoot);

  for (const r of [...roots]) {
    try {
      const vdf = await fs.readFile(path.join(r, "steamapps/libraryfolders.vdf"), "utf-8");
      for (const p of parseLibraryFolders(vdf)) {
        const norm = p.replace(/\\/g, "/");
        if (!roots.includes(norm)) roots.push(norm);
      }
    } catch { /* 该根没有 libraryfolders.vdf */ }
  }

  for (const r of FALLBACK_ROOTS) if (!roots.includes(r)) roots.push(r);

  for (const root of roots) {
    const weDir = path.join(root, "steamapps/common/wallpaper_engine");
    try {
      await fs.access(path.join(weDir, "wallpaper32.exe")).catch(() => fs.access(path.join(weDir, "wallpaper64.exe")));
      return {
        found: true,
        wallpaperEngineDir: weDir,
        workshopRoot: path.join(root, "steamapps/workshop/content/431960"),
        localProjectsDir: path.join(weDir, "projects"),
        steamRoot: root,
      };
    } catch { /* 继续试下一个根 */ }
  }

  return { found: false, wallpaperEngineDir: null, workshopRoot: null, localProjectsDir: null, steamRoot: null };
}

// 白名单校验：目标路径必须在 WE 库根之内（防目录穿越，Windows 下大小写不敏感）
export function isInsideWeRoots(target, paths) {
  const roots = [paths.workshopRoot, paths.localProjectsDir].filter(Boolean);
  if (!roots.length) return false;
  const resolved = path.resolve(target);
  const norm = (p) => path.resolve(p).toLowerCase();
  const r = norm(resolved);
  return roots.some((root) => r === norm(root) || r.startsWith(norm(root) + path.sep));
}

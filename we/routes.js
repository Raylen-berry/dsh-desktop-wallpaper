// 接线版 v3:
//   fix1: MEDIA_PREFIX 注册不带尾斜杠。DSH matcher (index.js:327) 是
//         pathname !== prefix && !pathname.startsWith(prefix + "/") -> miss,
//         注册 "/bga/we/media/" 时 "/bga/we/media//..." 永不成立, handler 进不去 (真 404)。
//         注册 "/bga/we/media" 后 "/bga/we/media/<id>/<rel>" 正常命中。
//   fix2: 拒发黑名单扩展名。scene.pkg (PKGV00200, WE 私有加密容器) 绝不外发;
//         可执行类与安装包类一并拒掉, 壁纸流只需要 媒体/字体/贴图/样式/脚本/文本。
// 其余结构同 v2: /bga/we/media/<id>/<rel> 路径形态 + id->entry 缓存 + resolve 结构性白名单。
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { discoverWePaths } from "./paths.js";
import { scanLibrary } from "./scanner.js";
import { bridgeStatus } from "./bridge.js";
import { composeStill } from "./still.js";

// wallpaper:// 协议是否注册 (HKCU 用户级 -> HKLM 机器级)。
// 进程内缓存一次即可: WE 升级补注册必然伴随 WE 重启, 而 DSH 宿主进程通常也随之重启;
// 且协议"存在但坏掉"时 openExternal 会 reject, routes 里有 try/catch 兜住。
let protoPromise = null;
function isProtocolRegistered() {
  if (protoPromise) return protoPromise;
  const keys = ["HKCU\\Software\\Classes\\wallpaper", "HKLM\\SOFTWARE\\Classes\\wallpaper"];
  protoPromise = new Promise((resolve) => {
    let pending = keys.length;
    for (const k of keys) {
      execFile("reg", ["query", k, "/ve"], { windowsHide: true }, (err) => {
        if (!err) { resolve(true); return }
        if (--pending === 0) resolve(false);
      });
    }
  });
  return protoPromise;
}

const MIME = {
  ".json": "application/json", ".gif": "image/gif", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".html": "text/html",
  ".htm": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".txt": "text/plain", ".frag": "text/plain",
  ".vert": "text/plain", ".glsl": "text/plain",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject", ".otf": "font/otf",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
};

// fix2: 永不通过壁纸流外发的扩展名。pkg=WE 私有容器; 其余为可执行/安装包类。
const DENY_EXT = new Set([
  ".pkg", ".exe", ".dll", ".so", ".dylib", ".bat", ".cmd", ".ps1",
  ".com", ".scr", ".msi", ".jar", ".deb", ".rpm",
]);

// fix1: 注册前缀不带尾斜杠, 与 index.js:649 ROUTE_PREFIX 形状一致
const MEDIA_PREFIX = "/bga/we/media";
const CACHE_TTL_MS = 60_000;

let pathsPromise = null;
const getPaths = () => (pathsPromise ??= discoverWePaths());

let entriesCache = { at: 0, map: new Map() };
async function getEntriesMap(force = false) {
  const now = Date.now();
  if (!force && now - entriesCache.at < CACHE_TTL_MS && entriesCache.map.size) return entriesCache.map;
  const paths = await getPaths();
  const list = paths.found ? await scanLibrary(paths) : [];
  entriesCache = { at: now, map: new Map(list.map(e => [e.id, e])) };
  return entriesCache.map;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  // fix2: 黑名单在流式发送前拦截, 大小写不敏感
  if (DENY_EXT.has(ext)) {
    return json(res, 403, { error: `file type not served: ${ext}` });
  }
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  fs.createReadStream(filePath)
    .on("error", () => { try { res.writeHead(404); } catch {} res.end(); })
    .pipe(res);
}

async function handleMedia(res, rawAfterPrefix) {
  const segs = rawAfterPrefix.split("/").map(s => {
    try { return decodeURIComponent(s); } catch { return null; }
  });
  if (segs.some(s => s === null) || segs.length < 2) {
    return json(res, 400, { error: "bad media path" });
  }
  const [id, ...relSegs] = segs;
  const entry = (await getEntriesMap()).get(id);
  if (!entry) return json(res, 404, { error: "unknown wallpaper id" });

  const entryRoot = path.resolve(entry.path);
  const abs = path.resolve(entryRoot, ...relSegs);
  const norm = (p) => p.toLowerCase();
  if (norm(abs) !== norm(entryRoot) && !norm(abs).startsWith(norm(entryRoot) + path.sep)) {
    return json(res, 403, { error: "rel escapes entry root" });
  }
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) return json(res, 404, { error: "not a file" });
    sendFile(res, abs);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

export function registerWeRoutes(webServer, deps = {}) {
  // ---- scene 类"解包出静态图" (见 we/still.js) ----
  // 生成一次约 5s、结果 ~1MB webp，落盘缓存 ⇒ 之后所有请求都是读文件。
  // 路由拆成两条: POST /bga/we/still?id= 触发（立刻返回，不阻塞），
  //              GET  /bga/we/still/<id>.webp 取（没好就 404，客户端轮询）。
  const stillsDir = deps.stillsDir || null;
  const stillJobs = new Map();
  const stillPath = (id) => (stillsDir ? path.join(stillsDir, `${id}.webp`) : null);
  const stillReady = (id) => { const p = stillPath(id); return !!p && fs.existsSync(p); };

  function ensureStill(id) {
    if (!stillsDir) return Promise.resolve({ state: "unsupported" });
    if (stillReady(id)) return Promise.resolve({ state: "ready" });
    if (stillJobs.has(id)) return stillJobs.get(id);
    const job = (async () => {
      const paths = await getPaths();
      const entry = (await getEntriesMap()).get(id);
      if (!entry) return { state: "unknown-id" };
      if (entry.type !== "scene") return { state: "not-scene" };
      const pkgFile = path.join(entry.path, "scene.pkg");
      if (!fs.existsSync(pkgFile)) return { state: "no-pkg" };
      const sharp = deps.getSharp ? await deps.getSharp() : null;
      if (!sharp) return { state: "no-sharp" };
      await fsp.mkdir(stillsDir, { recursive: true });
      const out = await composeStill({ pkgPath: pkgFile, sharp });
      await fsp.writeFile(stillPath(id), out.buffer);
      console.log(`[dsh-bg-atelier] we still: ${id} ${out.width}x${out.height} from ${out.layers} layers, ${(out.buffer.length / 1048576).toFixed(2)}MB`);
      return { state: "ready", width: out.width, height: out.height };
    })().catch((e) => {
      console.error(`[dsh-bg-atelier] we still failed for ${id}: ${e && e.message}`);
      return { state: "error", error: String((e && e.message) || e) };
    }).finally(() => { stillJobs.delete(id); });
    stillJobs.set(id, job);
    return job;
  }

  /** 给库条目补上"静态图好了没" —— 客户端据此决定先铺 gif 还是一步到位 */
  function withStill(entry) {
    return stillReady(entry.id)
      ? { ...entry, stillReady: true, still: `/bga/we/still/${encodeURIComponent(entry.id)}.webp` }
      : entry;
  }

  webServer.register({
    kind: "exact",
    path: "/bga/we/still",
    handler: async (req, res) => {
      const url = new URL(req.url, "http://local");
      if (req.method !== "POST") return json(res, 405, { error: "POST to generate" });
      const id = url.searchParams.get("id");
      if (!id || !/^\d+$/.test(id)) return json(res, 400, { error: "bad id" });
      const r = await ensureStill(id);
      json(res, 200, { ok: r.state !== "error", ...r });
    },
  });

  webServer.register({
    kind: "prefix",
    path: "/bga/we/still",
    handler: async (req, res) => {
      const url = new URL(req.url, "http://local");
      const m = url.pathname.slice("/bga/we/still".length).match(/^\/(\d+)\.webp$/);
      if (!m) return json(res, 400, { error: "want /bga/we/still/<id>.webp" });
      const p = stillPath(m[1]);
      let stat = null;
      try { stat = await fsp.stat(p); } catch { /* 还没生成 */ }
      if (!stat || !stat.isFile()) return json(res, 404, { error: "still not ready" });
      res.writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": stat.size,
        "Cache-Control": "public, max-age=86400",
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(p).on("error", () => { try { res.end(); } catch { /* noop */ } }).pipe(res);
    },
  });

  webServer.register({
    kind: "exact",
    path: "/bga/we/library.json",
    handler: async (req, res) => {
      const paths = await getPaths();
      if (!paths.found) return json(res, 200, { entries: [], weFound: false, scannedAt: Date.now() });
      const entries = (await scanLibrary(paths)).map(withStill);
      entriesCache = { at: Date.now(), map: new Map(entries.map(e => [e.id, e])) };
      json(res, 200, { entries, weFound: true, scannedAt: Date.now() });
    },
  });

  // fix1: path 不带尾斜杠; handler 剥前缀后去首个 "/" 再交给 handleMedia
  webServer.register({
    kind: "prefix",
    path: MEDIA_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url, "http://local");
      const rest = url.pathname.slice(MEDIA_PREFIX.length).replace(/^\//, "");
      await handleMedia(res, rest);
    },
  });

  webServer.register({
    kind: "exact",
    path: "/bga/we/status",
    handler: async (req, res) => {
      const url = new URL(req.url, "http://local");
      const paths = await getPaths();
      const bridge = await bridgeStatus(url.searchParams.get("force") === "1");
      json(res, 200, {
        weFound: paths.found,
        steamRoot: paths.steamRoot,
        bridge: { available: bridge.available, mode: bridge.available ? "online" : "offline", detail: bridge.detail },
      });
    },
  });

  webServer.register({
    kind: "exact",
    path: "/bga/we/open-in-we",
    handler: async (req, res) => {
      const url = new URL(req.url, "http://local");
      const id = url.searchParams.get("id");
      if (!id || !/^\d+$/.test(id)) return json(res, 400, { error: "bad id" });
      // wallpaper:// URI 只有部分安装会注册协议 (实测本机 HKLM/HKCU Classes\wallpaper 均无 ->
      // 未知协议被 Windows 兜底成微软商店搜索页)。故先探测注册表, 未注册走 steam:// CLI。
      const proto = await isProtocolRegistered();
      if (proto && typeof deps.openExternal === "function") {
        try {
          await deps.openExternal(`wallpaper://open?id=${id}`);
          return json(res, 200, { ok: true, via: "uri" });
        } catch (e) {
          return json(res, 500, { error: String(e?.message ?? e) });
        }
      }
      // steam:// 兜底 (实测本机已注册): 打开 WE 应用并切到该壁纸 —— 与按钮语义一致。
      const paths = await getPaths();
      const entry = (await getEntriesMap()).get(id);
      // 本体文件: video/web 类 file 字段就是磁盘相对路径; scene 类的 file(scene.json) 在 .pkg 内,
      // 磁盘上不存在 —— 改用同目录的 scene.pkg 实体 (scanner 的 preview 探法同款)。
      let mainFile = null;
      if (entry && entry.file) {
        const direct = path.join(entry.path, entry.file);
        if (fs.existsSync(direct)) {
          mainFile = direct;
        } else {
          const pkg = path.join(entry.path, "scene.pkg");
          if (fs.existsSync(pkg)) mainFile = pkg;
        }
      }
      const steamExe = paths.steamRoot ? path.join(paths.steamRoot.replace(/\//g, path.sep), "steam.exe") : null;
      if (steamExe && fs.existsSync(steamExe)) {
        // `-p <file>` 是 WE 官方 CLI 开壁纸形态; 拿不到本体文件时退回只拉起界面。
        const args = mainFile
          ? ["-applaunch", "431960", "-p", mainFile]
          : ["-applaunch", "431960", "-control", "open"];
        try {
          await deps.spawnLauncher(steamExe, args);
          json(res, 200, { ok: true, via: "steam" });
        } catch (e) {
          json(res, 500, { error: String(e?.message ?? e) });
        }
        return;
      }
      // 最后兜底: 只拉起 WE 主界面 (不指定壁纸)。
      const weDir = paths.wallpaperEngineDir;
      const weExe = weDir && (fs.existsSync(path.join(weDir, "wallpaper64.exe"))
        ? path.join(weDir, "wallpaper64.exe")
        : path.join(weDir, "wallpaper32.exe"));
      if (!weExe) return json(res, 501, { error: "no route to open WE: protocol unregistered, steam.exe and WE exe both unavailable" });
      try {
        await deps.spawnLauncher(weExe, ["-control", "open"]);
        json(res, 200, { ok: true, via: "cli-ui-only" });
      } catch (e) {
        json(res, 500, { error: String(e?.message ?? e) });
      }
    },
  });
}

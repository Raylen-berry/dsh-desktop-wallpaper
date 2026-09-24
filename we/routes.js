// WE library, media, bounded scene jobs and official CLI launch routes.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { discoverWePaths } from './paths.js';
import { bridgeStatus } from './bridge.js';
import { createLibraryCache } from './library-cache.js';
import { createStillQueue, runStillWorker } from './jobs.js';
const MIME = {
  ".json": "application/json", ".gif": "image/gif", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml",
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

const validId = (id) => /^(?:\d+|local-[a-f0-9]{24})$/.test(id || '');
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function entryFile(entry, rel) {
  const root = await fsp.realpath(entry.path);
  const file = await fsp.realpath(path.resolve(root, rel));
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('path outside project');
  if (!(await fsp.stat(file)).isFile()) throw new Error('not a file');
  return file;
}
async function sendFile(req, res, filePath, extra = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (DENY_EXT.has(ext)) return json(res, 403, { error: 'file type not served: ' + ext });
  const stat = await fsp.stat(filePath);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', ...extra };
  let start = 0, end = stat.size - 1, status = 200;
  if (req.headers?.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); return res.end(); }
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); return res.end(); }
    status = 206; headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size; headers['Content-Length'] = end - start + 1;
  }
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || stat.size === 0) return res.end();
  fs.createReadStream(filePath, { start, end }).on('error', () => res.destroy()).pipe(res);
}

export function registerWeRoutes(webServer, deps = {}) {
  let pathsPromise;
  const getPaths = (force = false) => { if (force || !pathsPromise) pathsPromise = (deps.discoverPaths || discoverWePaths)(); return pathsPromise; };
  const library = createLibraryCache(getPaths, deps.cacheOptions);
  const status = deps.bridgeStatus || bridgeStatus;
  const jobs = createStillQueue(deps.queueOptions);
  const disposers = [];
  const register = (route) => disposers.push(webServer.register(route));
  const stillPath = (id) => deps.stillsDir && validId(id) ? path.join(deps.stillsDir, id + '.webp') : null;
  const ready = (id) => !!stillPath(id) && fs.existsSync(stillPath(id));
  const current = (id) => ready(id) ? { state: 'ready' } : jobs.get(id);
  async function compose(id, signal) {
    if (!deps.stillsDir) throw new Error('静态图缓存目录不可用');
    const entry = (await library()).map.get(id);
    if (!entry || entry.type !== 'scene') throw new Error('找不到场景项目');
    let pkgPath;
    try { pkgPath = await entryFile(entry, 'scene.pkg'); }
    catch { throw new Error('此场景没有可用的 scene.pkg，保留预览；完整效果请在 WE 打开'); }
    const out = await (deps.composeWorker || runStillWorker)({ pkgPath, sharpCandidates: deps.sharpCandidates }, { signal });
    if (signal.aborted) throw new Error('静态图任务已取消');
    await fsp.mkdir(deps.stillsDir, { recursive: true });
    const destination = stillPath(id), temporary = destination + '.tmp';
    try { await fsp.writeFile(temporary, out.buffer); if (signal.aborted) throw new Error('任务已取消'); await fsp.rename(temporary, destination); }
    finally { await fsp.rm(temporary, { force: true }); }
    return { width: out.width, height: out.height };
  }
  register({ kind: 'exact', path: '/bga/we/still', handler: async (req, res) => {
    const id = new URL(req.url, 'http://local').searchParams.get('id');
    if (!validId(id)) return json(res, 400, { error: 'bad id' });
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'GET status / POST generate' });
    const entry = (await library()).map.get(id);
    if (!entry || entry.type !== 'scene') return json(res, 404, { state: 'error', error: '找不到场景项目' });
    const result = req.method === 'GET' || ready(id) ? current(id) : jobs.start(id, (signal) => compose(id, signal));
    json(res, ['running', 'queued'].includes(result.state) ? 202 : 200, { ok: !['error', 'busy'].includes(result.state), ...result });
  }});
  register({ kind: 'prefix', path: '/bga/we/still', handler: async (req, res) => {
    const id = new URL(req.url, 'http://local').pathname.slice('/bga/we/still/'.length).replace(/\.webp$/, '');
    if (!validId(id)) return json(res, 400, { error: 'bad id' });
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'read only' });
    if (!ready(id)) return json(res, 404, { error: 'still not ready' });
    await sendFile(req, res, stillPath(id), { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400' });
  }});
  register({ kind: 'exact', path: '/bga/we/library.json', handler: async (req, res) => {
    const force = new URL(req.url, 'http://local').searchParams.get('force') === '1';
    const loaded = await library(force);
    const entries = loaded.entries.map(e => ({ ...e, stillStatus: e.type === 'scene' ? current(e.id) : undefined,
      ...(ready(e.id) ? { stillReady: true, still: '/bga/we/still/' + e.id + '.webp' } : {}) }));
    json(res, 200, { entries, weFound: loaded.paths.found, scannedAt: loaded.scannedAt });
  }});
  register({ kind: 'prefix', path: MEDIA_PREFIX, handler: async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'read only' });
    let parts;
    try { parts = new URL(req.url, 'http://local').pathname.slice(MEDIA_PREFIX.length + 1).split('/').map(decodeURIComponent); }
    catch { return json(res, 400, { error: 'bad media path' }); }
    const [id, ...relative] = parts;
    if (!validId(id) || !relative.length) return json(res, 400, { error: 'bad media path' });
    const entry = (await library()).map.get(id);
    if (!entry) return json(res, 404, { error: 'unknown wallpaper id' });
    try { await sendFile(req, res, await entryFile(entry, relative.join('/'))); }
    catch { json(res, 404, { error: 'file unavailable or outside project' }); }
  }});
  register({ kind: 'exact', path: '/bga/we/status', handler: async (req, res) => {
    const force = new URL(req.url, 'http://local').searchParams.get('force') === '1';
    const paths = await getPaths(force), bridge = await status(force);
    json(res, 200, { weFound: paths.found, running: bridge.running, bridge: { ...bridge, mode: 'local', rpcSupported: false } });
  }});
  register({ kind: 'exact', path: '/bga/we/open-in-we', handler: async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
    const id = new URL(req.url, 'http://local').searchParams.get('id');
    if (!validId(id)) return json(res, 400, { error: 'bad id' });
    const loaded = await library(), entry = loaded.map.get(id);
    if (!entry || !['scene', 'web', 'video'].includes(entry.type)) return json(res, 404, { error: 'project unavailable or unsupported' });
    try {
      const project = await entryFile(entry, 'project.json');
      const runtime = await status(true);
      const weDir = loaded.paths.wallpaperEngineDir;
      const preferred = ['wallpaper32.exe', 'wallpaper64.exe'].includes(runtime.executable) ? runtime.executable : 'wallpaper64.exe';
      const exe = [preferred, 'wallpaper64.exe', 'wallpaper32.exe'].map(name => path.join(weDir, name)).find(file => fs.existsSync(file));
      if (!exe || !deps.spawnLauncher) return json(res, 501, { error: 'WE 启动器不可用' });
      // Official CLI requires an already-running WE process. Never claim a
      // particular wallpaper was opened when only its application was launched.
      const targeted = runtime.running === true;
      const args = targeted ? ['-control', 'openWallpaper', '-file', project] : ['-control', 'open'];
      await deps.spawnLauncher(exe, args);
      json(res, 200, { ok: true, targeted, via: targeted ? 'we-cli' : 'we-ui-only',
        message: targeted ? '已发送到 WE' : '已打开 WE 界面；运行就绪后请再点一次' });
    } catch (error) { json(res, 500, { error: String(error.message || error) }); }
  }});
  return () => { jobs.dispose(); for (const dispose of disposers) if (typeof dispose === 'function') dispose(); };
}

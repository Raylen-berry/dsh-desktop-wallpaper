// WE process state and optional TCP diagnostic are separate facts.
// Neither a running process nor port 16260 implies a supported WebSocket RPC.
import net from "node:net";
import { execFile } from "node:child_process";

const WE_PORT = 16260;
const CACHE_MS = 30_000;

let cache = { at: 0, result: null };

export async function probeProcess(run = execFile) {
  if (process.platform !== 'win32') return Promise.resolve({ running: null, detail: 'unsupported-platform' });
  const results = await Promise.all(['wallpaper64.exe', 'wallpaper32.exe'].map(executable => new Promise((resolve) => {
    run('tasklist', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq ' + executable],
      { encoding: 'utf8', windowsHide: true, timeout: 2500, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error
        ? { running: null, detail: 'process-query-failed' }
        : { running: /^\s*"wallpaper(?:32|64)\.exe",/im.test(stdout), executable, detail: 'process-list' }));
  })));
  return results.find(r => r.running === true) || results.find(r => r.running === null) || { running: false, detail: 'process-list' };
}

function probePort(timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port: WE_PORT, host: "127.0.0.1" });
    const done = (available, detail) => {
      sock.destroy();
      resolve({ available, port: WE_PORT, detail });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true, "listening"));
    sock.once("timeout", () => done(false, "timeout"));
    sock.once("error", (e) => done(false, e?.code ?? "error"));
  });
}

export async function bridgeStatus(force = false) {
  const now = Date.now();
  if (!force && cache.result && now - cache.at < CACHE_MS) return cache.result;
  const [port, runtime] = await Promise.all([probePort(), probeProcess()]);
  cache = { at: now, result: { ...port, ...runtime, portDetail: port.detail, rpcSupported: false, mode: 'local' } };
  return cache.result;
}

// No RPC provider is advertised: a listening TCP port is not a control API.

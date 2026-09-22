// M-E: Wallpaper Engine bridge。
// 官方公开能力: wallpaper://open?id=<id> URI 调起 + localhost:16260 内部 WS(websockets.js SDK)。
// 本机实测 WE 运行时不一定有 16260 监听, 故按"可能不可用"设计:
//   - 端口探测用裸 TCP(无 WS 依赖), 只回答"WE 内部服务在不在"
//   - 真 WS 协议通信(getWallpapers/applyWallpaper 等)留待有可用环境时补, 接口位置已留
import net from "node:net";

const WE_PORT = 16260;
const CACHE_MS = 30_000;

let cache = { at: 0, result: null };

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
  cache = { at: now, result: await probePort() };
  return cache.result;
}

// 留接口: 16260 可用后在此实现 WE SDK 通信(getWallpapers / applyWallpaper / 事件订阅)
export async function weRpc() {
  throw new Error("WE websocket RPC not implemented yet: no test environment with 16260 listening");
}

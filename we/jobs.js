import { Worker } from 'node:worker_threads';

// CPU decoding runs outside the host event loop. At most one worker is active.
export function runStillWorker(options, { signal, timeoutMs = 45000, workerUrl = new URL('./still-worker.js', import.meta.url) } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('静态图任务已取消'));
    const worker = new Worker(workerUrl, { workerData: options, resourceLimits: { maxOldGenerationSizeMb: 256 }, execArgv: [] });
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate().then(() => error ? reject(error) : resolve(result), reject);
    };
    const abort = () => finish(new Error('静态图任务已取消'));
    const timer = setTimeout(() => finish(new Error('静态图生成超时（45 秒上限）')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message) => finish(message.error ? new Error(message.error) : null, message));
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => { if (!done) finish(new Error(`静态图进程退出 (${code})`)); });
  });
}

export function createStillQueue({ now = Date.now, retryMs = 60000, maxPending = 8 } = {}) {
  const records = new Map(), pending = [], controller = new AbortController();
  let active = false, closed = false;
  async function drain() {
    if (active || closed || !pending.length) return;
    active = true;
    const { id, task } = pending.shift();
    records.set(id, { state: 'running' });
    try {
      const result = await task(controller.signal);
      if (!closed) records.set(id, { state: 'ready', ...result });
    } catch (error) {
      if (!closed) records.set(id, { state: 'error', error: String(error.message || error), retryAt: now() + retryMs });
    } finally { active = false; drain(); }
  }
  return {
    get(id) { return records.get(id) || { state: 'idle' }; },
    start(id, task) {
      if (closed) return { state: 'error', error: '插件已停止' };
      const old = records.get(id);
      if (old && (['queued', 'running'].includes(old.state) || old.state === 'error' && now() < old.retryAt)) return old;
      if (pending.length >= maxPending) return { state: 'busy', error: '生成队列已满，请稍后重试' };
      if (records.size >= 256) for (const [key, value] of records) {
        if (!['queued', 'running'].includes(value.state)) records.delete(key);
        if (records.size < 128) break;
      }
      records.set(id, { state: 'queued' });
      pending.push({ id, task });
      drain();
      return records.get(id);
    },
    dispose() { closed = true; pending.length = 0; controller.abort(); },
  };
}

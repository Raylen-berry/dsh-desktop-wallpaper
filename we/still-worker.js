import { parentPort, workerData } from 'node:worker_threads';
import { composeStill } from './still.js';

try {
  let sharp;
  for (const spec of workerData.sharpCandidates || ['sharp']) {
    try { const module = await import(spec); sharp = module.default || module; if (typeof sharp === 'function') break; } catch { /* try host candidate */ }
  }
  if (typeof sharp !== 'function') throw new Error('缺少图像处理组件 sharp，保留预览图');
  sharp.cache(false);
  sharp.concurrency(1);
  const result = await composeStill({ pkgPath: workerData.pkgPath, sharp });
  const buffer = Uint8Array.from(result.buffer);
  parentPort.postMessage({ ...result, buffer }, [buffer.buffer]);
} catch (error) { parentPort.postMessage({ error: String(error.message || error) }); }

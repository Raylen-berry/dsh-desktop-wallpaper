import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLibraryCache } from '../we/library-cache.js';
import { createStillQueue, runStillWorker } from '../we/jobs.js';
import { probeProcess } from '../we/bridge.js';
import { lz4Decode, decodeDXT, readTex, decodeTex } from '../we/tex.js';
import { readPkg, readPkgFile } from '../we/pkg.js';
import { LIMITS } from '../we/limits.js';

let now = 0, scans = 0, discoveries = 0;
const cache = createLibraryCache(async () => { discoveries++; return { found: true }; }, {
  now: () => now, scan: async () => { scans++; return []; }, ttl: 60,
});
const [first, same] = await Promise.all([cache(), cache()]);
assert.equal(first, same); assert.equal(scans, 1);
await cache(); assert.equal(scans, 1, 'empty library also cached');
now = 61; await cache(); assert.equal(scans, 2);
await cache(true); assert.equal(scans, 3); assert.equal(discoveries, 3);
console.log('PASS shared library cache: concurrent / empty / TTL / force');

if (process.platform === 'win32') {
  const running = await probeProcess((file, args, opts, callback) => {
    assert.ok(['IMAGENAME eq wallpaper64.exe', 'IMAGENAME eq wallpaper32.exe'].includes(args.at(-1)), 'exact process filters');
    callback(null, '"wallpaper64.exe","123","Console"');
  });
  assert.equal(running.running, true);
  assert.equal((await probeProcess((f,a,o,cb) => cb(null, 'INFO: no tasks'))).running, false);
  assert.equal((await probeProcess((f,a,o,cb) => cb(new Error('denied')))).running, null);
}
console.log('PASS process probe distinguishes running / stopped / unknown');

const turn = () => new Promise(resolve => setImmediate(resolve));
const queue = createStillQueue({ now: () => now, retryMs: 60, maxPending: 1 });
let finish, calls = 0;
queue.start('a', () => new Promise(resolve => { calls++; finish = resolve; }));
assert.equal(queue.start('a', () => { throw Error('duplicate'); }).state, 'running');
queue.start('b', async () => { calls++; throw Error('bad scene'); });
assert.equal(queue.start('c', async () => ({})).state, 'busy');
finish({ width: 1 }); await turn(); await turn();
assert.equal(calls, 2); assert.equal(queue.get('a').state, 'ready'); assert.equal(queue.get('b').state, 'error');
queue.start('b', async () => { calls++; }); assert.equal(calls, 2, 'failure backs off');
now += 61; queue.start('b', async () => { calls++; return {}; }); await turn();
assert.equal(calls, 3); assert.equal(queue.get('b').state, 'ready');
queue.dispose(); assert.equal(queue.start('d', async () => ({})).state, 'error');
console.log('PASS bounded queue: single flight / serial / busy / retry / dispose');

assert.throws(() => lz4Decode(Buffer.from([0xf0]), 3));
assert.throws(() => lz4Decode(Buffer.from([0x30,1,2,3]), 1));
assert.throws(() => lz4Decode(Buffer.from([0,0,0]), 4));
assert.throws(() => lz4Decode(Buffer.alloc(0), LIMITS.decodedBytes + 1));
assert.throws(() => decodeDXT(20000, 20000, Buffer.alloc(0), 'DXT1'));
assert.throws(() => decodeDXT(4, 4, Buffer.alloc(1), 'DXT1'));
assert.throws(() => readTex(Buffer.from('not-terminated')));
assert.throws(() => readPkg(Buffer.from([255,255,255,255])));
// TEXB0001 stores the byte count directly, without compression fields.
// Reading the wrong digit of the marker used to take the V2 layout here.
const ints = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeInt32LE(v, i * 4)); return b; };
const rgba = Buffer.from([12, 34, 56, 255]);
const v1 = readTex(Buffer.concat([
  Buffer.from('TEXV0005\0TEXI0001\0'), ints(0, 0, 1, 1, 1, 1, 0),
  Buffer.from('TEXB0001\0'), ints(1, 1, 1, 1, rgba.length), rgba,
]));
assert.deepEqual(decodeTex(v1).data, rgba, 'V1 texture pixels survive decoding');
console.log('PASS malformed/oversized decoder inputs rejected before expensive allocation');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'we-worker-'));
try {
  const big = path.join(root, 'large.pkg'); const fd = await fs.open(big, 'w');
  await fd.truncate(LIMITS.packageBytes + 1); await fd.close();
  assert.throws(() => readPkgFile(big), /上限/);
  const worker = path.join(root, 'busy.mjs'); await fs.writeFile(worker, 'while (true) {}');
  let ticked = false; const timer = setTimeout(() => { ticked = true; }, 10);
  await assert.rejects(runStillWorker({}, { workerUrl: pathToFileURL(worker), timeoutMs: 100 }), /超时/);
  clearTimeout(timer); assert.equal(ticked, true, 'host event loop stays responsive');
  const controller = new AbortController();
  const pending = runStillWorker({}, { workerUrl: pathToFileURL(worker), signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /取消/);
  await fs.writeFile(worker, 'process.exit(2)');
  await assert.rejects(runStillWorker({}, { workerUrl: pathToFileURL(worker) }), /退出/);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('PASS worker isolation: package cap / timeout / event loop / cancel / crash');

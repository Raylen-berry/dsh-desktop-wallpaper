import { scanLibrary } from './scanner.js';

export function createLibraryCache(getPaths, { scan = scanLibrary, now = Date.now, ttl = 60000 } = {}) {
  let value = null, pending = null;
  return async function load(force = false) {
    if (pending) return pending;
    if (!force && value && now() - value.scannedAt < ttl) return value;
    pending = (async () => {
      const paths = await getPaths(force);
      const entries = paths.found ? await scan(paths) : [];
      value = { paths, entries, map: new Map(entries.map(e => [e.id, e])), scannedAt: now() };
      return value;
    })();
    try { return await pending; } finally { pending = null; }
  };
}

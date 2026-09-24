import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanLibrary } from '../we/scanner.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'we-library-'));
try {
  const paths = { workshopRoot: path.join(root, 'workshop'), localProjectsDir: path.join(root, 'projects') };
  for (const [rel, title] of [['workshop/123', '订阅'], ['projects/myprojects/同名', '本地甲'], ['projects/defaultprojects/同名', '本地乙'], ['projects/direct', '旧布局']]) {
    const dir = path.join(root, rel);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ title, type: 'scene', file: 'scene.json' }));
    await fs.writeFile(path.join(dir, 'preview.png'), 'fixture');
  }
  const entries = await scanLibrary(paths);
  assert.equal(entries.filter(e => e.source === 'local').length, 3, 'grouped and direct local projects are all found');
  assert.equal(new Set(entries.map(e => e.id)).size, 4, 'same basename across groups does not collide');
  assert.equal(entries.find(e => e.source === 'workshop').id, '123', 'workshop id preserved');
  assert.deepEqual(await scanLibrary(paths), entries, 'stable IDs and ordering');
  assert.ok(entries.every(e => e.previewRel === 'preview.png'));
  console.log('PASS WE library: grouped/direct layouts, unique stable IDs, legacy workshop IDs, previews');
} finally { await fs.rm(root, { recursive: true, force: true }); }

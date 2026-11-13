import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('a packed production install contains the complete editor with the same engine as the backend', async (t) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const temporary = await mkdtemp(path.join(tmpdir(), 'openpresent-editor-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
    cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: path.join(temporary, 'cache') },
  }))[0];
  execFileSync('tar', ['-xzf', path.join(temporary, packed.filename), '-C', temporary]);
  // No source checkout or devDependencies exist beside this extracted package.
  const installed = path.join(temporary, 'package');
  const { assetsDirectory, engineFile } = await import(pathToFileURL(path.join(installed, 'npm/index.mjs')));
  assert.equal(typeof assetsDirectory, 'string');
  const at = (file) => path.join(assetsDirectory, file);
  const manifest = JSON.parse(await readFile(at('amodal-build.json'), 'utf8'));
  assert.match(manifest.version, /^[a-f0-9]{20}$/);
  const engine = await readFile(engineFile);
  assert.deepEqual(await readFile(at('pkg/casual_slide_wasm_bg.wasm')), engine);
  assert.equal(manifest.engineSha256, createHash('sha256').update(engine).digest('hex'));
  const runtime = await readFile(at('editor-runtime.js'), 'utf8');
  assert.ok(runtime.includes(JSON.stringify(manifest.engineSha256)));
  const { mountEditor } = await import(pathToFileURL(at('editor-runtime.js')));
  assert.equal(typeof mountEditor, 'function');
  for (const file of ['amodal-editor.html', 'amodal-editor.js', 'amodal-editor.css', 'render.worker.js',
    'pkg/casual_slide_wasm.js', 'fonts/cjk/manifest.json', 'LICENSE', 'NOTICE']) {
    assert.ok((await stat(at(file))).size > 0, file);
  }
  assert.ok((await stat(at('font-licenses'))).isDirectory());
  const page = await readFile(at('amodal-editor.html'), 'utf8');
  assert.ok(page.includes('src="./amodal-editor.js"'));
  assert.ok(!page.includes('src="./editor.js"'));
  assert.ok(!packed.files.some(({path: file}) => file.startsWith('npm/editor/') || file.includes('build-editor')));
});

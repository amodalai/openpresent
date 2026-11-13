import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const entry = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await files(entry));
    else result.push(entry);
  }
  return result;
}

test('the packed package exports complete, unchanged offline validation assets and notices', async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'openpresent-package-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
    cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: path.join(temporary, 'cache') },
  }))[0];
  execFileSync('tar', ['-xzf', path.join(temporary, packed.filename), '-C', temporary]);
  const installed = path.join(temporary, 'package');
  const exports = await import(pathToFileURL(path.join(installed, 'npm/index.mjs')));
  assert.equal(typeof exports.validationDirectory, 'string');
  assert.equal(await realpath(exports.validationDirectory), await realpath(installed), 'validation paths must resolve inside the installed package');
  const assets = [
    ...await files(path.join(root, 'schemas')),
    ...await files(path.join(root, 'tools/f4')),
    path.join(root, 'LICENSE'), path.join(root, 'NOTICE'),
  ].filter((file) => !file.includes('__pycache__') && !file.endsWith('test_validate.py'));
  for (const source of assets) {
    const relative = path.relative(root, source);
    assert.deepEqual(await readFile(path.join(installed, relative)), await readFile(source), relative);
  }
  assert.ok(!packed.files.some(({ path: file }) => file.startsWith('fixtures/') || file.includes('__pycache__')));
  const result = JSON.parse(execFileSync('python3', ['-c', `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('packed_validator',sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(module.validate_deck(__import__('pathlib').Path(sys.argv[2]))))
`, path.join(exports.validationDirectory, 'tools/f4/validate.py'), path.join(root, 'fixtures/generated/minimal.pptx')], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  }));
  assert.equal(result.status, 'pass', JSON.stringify(result));
  assert.ok(result.parts.length > 0, 'the packaged validator must inspect the deck');
  assert.ok(result.parts.every((part) => !part.errors?.length), JSON.stringify(result));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const engineDir = process.env.OPENPRESENT_ENGINE_DIR || new URL('../../webapp/pkg/', import.meta.url).pathname;
const engine = await import(pathToFileURL(path.join(engineDir, 'casual_slide_wasm.js')));
engine.initSync({ module: await readFile(path.join(engineDir, 'casual_slide_wasm_bg.wasm')) });
const workerUrl = new URL('../../webapp/render.worker.js', import.meta.url);
const source = (await readFile(workerUrl, 'utf8'))
  .replace(/import init, \{[\s\S]*?\} from "\.\/pkg\/casual_slide_wasm\.js";/, '')
  .replaceAll('import.meta.url', JSON.stringify(workerUrl.href));
const selectionSource = await readFile(new URL('../../webapp/editor.selection.js', import.meta.url), 'utf8');
const historySource = selectionSource.slice(selectionSource.indexOf('async function historyOnce('), selectionSource.indexOf('\nfunction nudge('));

function worker() {
  let response;
  const self = { postMessage: (value) => { response = value; } };
  // Execute the full production dispatch chain against real WASM. This catches
  // an earlier duplicate branch shadowing the correct history response.
  vm.runInNewContext(source, { ...engine, init: async () => {}, self, URL, Uint8Array, Uint32Array, Float64Array, Int32Array });
  return async (message) => {
    response = undefined;
    await self.onmessage({ data: { id: 1, ...message } });
    assert.equal(response?.ok, true, response?.error);
    return response;
  };
}

test('slide insertion, duplication and deletion undo/redo report the current slide count', async () => {
  const request = worker();
  await request({ op: 'blank' });
  const layout = Number(engine.slide_layout(0));
  for (const [fn, args, before, after] of [
    ['new_slide', [1, layout], 1, 2],
    ['duplicate_slide', [0], 2, 3],
    ['delete_slide', [2], 3, 2],
    ['delete_slide', [1], 2, 1],
    ['delete_slide', [0], 1, 0],
  ]) {
    await request({ op: 'build', fn, args });
    assert.equal(engine.slide_count(), after);
    const undone = await request({ op: 'undo' });
    assert.equal(undone.count, before, `${fn}: undo count`);
    assert.equal(engine.slide_count(), before);
    const redone = await request({ op: 'redo' });
    assert.equal(redone.count, after, `${fn}: redo count`);
    assert.equal(engine.slide_count(), after);
    assert.equal(redone.size.length, 2, 'history still reports slide dimensions');
    assert.equal(redone.undo.length, 2, 'history still reports undo/redo availability');
  }
});

test('the editor rebuilds thumbnails after undo/redo and redraws same-count slide size changes', async () => {
  const request = worker();
  await request({ op: 'blank' });
  await request({ op: 'build', fn: 'duplicate_slide', args: [0] });
  const state = { deck: { count: 2 }, current: 1 };
  const reloads = [], redraws = [];
  const history = vm.runInNewContext(historySource + '\nhistoryOnce', {
    request, state, afterEdit: () => {},
    document: { dispatchEvent: () => {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
    slides: {
      reloadList: (count, index) => { state.deck.count = count; reloads.push([count, index]); },
      redrawAll: (size) => redraws.push(Array.from(size)),
      redrawSlide: () => {},
      go: (index) => { state.current = index; },
    },
    errorDialog: (_title, message) => assert.fail(message),
  });
  await history('undo');
  assert.equal(state.deck.count, 1);
  await history('redo');
  assert.equal(state.deck.count, 2);
  assert.equal(reloads.length, 2, 'both changes rebuild the thumbnail list');
  const originalSize = Array.from(engine.slide_size());
  await request({ op: 'design', fn: 'design_slide_size', args: [9144000, 6858000, 0] });
  await history('undo');
  assert.deepEqual(redraws.at(-1), originalSize, 'size undo redraws every slide');
  assert.equal(reloads.length, 2, 'same-count size changes do not rebuild the list');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Exercise the editor's actual private replacement function against the compiled
// engine, without browser rendering. UI checks cover the event/selection wiring.
const engineDir = process.env.OPENPRESENT_ENGINE_DIR || new URL('../../webapp/pkg/', import.meta.url).pathname;
const engine = await import(pathToFileURL(path.join(engineDir, 'casual_slide_wasm.js')));
engine.initSync({ module: await readFile(path.join(engineDir, 'casual_slide_wasm_bg.wasm')) });
const source = await readFile(new URL('../../webapp/editor.text.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function insertNow('), source.indexOf('\nfunction remove('));
assert.ok(body.startsWith('async function insertNow('));

for (const typing of [false, true]) {
  test(`${typing ? 'typing' : 'plain paste'} preserves selected text style and replaces in one undo step`, async () => {
    engine.open_blank();
    const node = engine.insert_shape(0, 0, 500000, 500000, 8000000, 1000000);
    const part = Number(engine.slide_outline(0)[0]);
    const original = 'Styled title';
    engine.text_replace_all(part, node, original);
    engine.text_set_run(part, node, 0, original.length, 0, 'Carlito');
    engine.text_set_run(part, node, 0, original.length, 1, '44');
    engine.text_set_run(part, node, 0, original.length, 2, 'srgb FFFFFF');
    engine.text_toggle(part, node, 0, original.length, 0);
    const originalRuns = engine.text_body_runs(part, node);
    const runState = [...engine.text_run_state(part, node, 0)];
    const format = engine.text_format_state(part, node, 0);
    const selection = { editing: true, anchor: 0, focus: original.length };
    const insert = vm.runInNewContext(body + '\ninsertNow', {
      selection, obj: () => [part, node], textRange: () => [selection.anchor, selection.focus],
      call: async (name, ...args) => engine[name](...args),
      select: (next) => Object.assign(selection, next), afterEdit: async () => {},
    });
    const replacement = 'Replacement ✓';
    await insert(replacement, typing);
    assert.deepEqual([...engine.text_run_state(part, node, 0)], runState, 'font and size must survive replacement');
    assert.equal(engine.text_format_state(part, node, 0), format, 'emphasis must survive replacement');
    const savedRuns = engine.text_body_runs(part, node);
    assert.equal(engine.text_slice(part, node, 0, engine.text_length(part, node)), replacement);
    engine.undo();
    assert.equal(engine.text_body_runs(part, node), originalRuns, 'one undo restores original content and style');
    engine.redo();
    assert.equal(engine.text_body_runs(part, node), savedRuns);
    const bytes = engine.save_deck();
    engine.open(bytes);
    assert.equal(engine.text_body_runs(part, node), savedRuns, 'export/reopen preserves emphasis');
    assert.deepEqual([...engine.text_run_state(part, node, 0)], runState, 'export/reopen preserves font and size');
  });
}

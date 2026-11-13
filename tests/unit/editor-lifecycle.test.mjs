/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const engine = (globalThis.__presentationEngine = { edits: 0, save: undefined });
const bundle = build({
  entryPoints: [fileURLToPath(new URL('../../npm/editor/amodal-editor.js', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  plugins: [
    {
      name: 'controlled-engine',
      setup(plugin) {
        plugin.onResolve({ filter: /^\.\.\/\.\.\/webapp\// }, (args) => ({
          path: args.path,
          namespace: 'engine',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'engine' }, () => ({
          contents: `
          const engine = globalThis.__presentationEngine;
          export const state = { deck: { count: 2 } };
          export const boot = async () => {};
          export const openDeck = async () => {};
          export const editsNow = () => engine.edits;
          export const request = async () => ({ bytes: new Uint8Array(), editsNow: engine.edits });
          export const command = () => ({ enabled: () => true });
          export const register = (id, entry) => {
            if (id === 'file.save') engine.save = entry.run;
          };
          export const registeredIds = () => [null, 'file.new', 'file.open', 'file.share'];
          export const run = () => {};
          export const go = () => {};
        `,
        }));
      },
    },
  ],
});

async function mountEditor(t, fetch, options = {}) {
  engine.edits = 0;
  const dom = new JSDOM(
    '<div id="stage"></div><div id="notes-pane"></div><div class="bottom-bar"></div><div class="op-ribbon"></div>',
  );
  const oldDocument = globalThis.document,
    oldWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  t.after(() => {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    dom.window.close();
  });
  t.mock.method(globalThis, 'setInterval', () => 0);
  t.mock.method(globalThis, 'fetch', fetch);
  const { mount } = await import(
    'data:text/javascript;base64,' + Buffer.from((await bundle).outputFiles[0].text).toString('base64')
  );
  const editor = await mount({
    apiUrl: '/deck',
    engineSha256: 'test',
    signal: new AbortController().signal,
    ...options,
  });
  await editor.refresh();
  return {
    editor,
    root: dom.window.document.documentElement,
    newSlide: dom.window.document.querySelector('[aria-label="New slide"]'),
  };
}

const snapshot = (revision = '1') =>
  new Response(JSON.stringify({ engineId: 'test', nativeRevision: revision, events: [{}], agentBusy: false }));
const deck = (revision = '1') => new Response(new Uint8Array(), { headers: { 'X-Deck-Version': revision } });

test('chat preparation waits for an in-flight background refresh and retains the edit lock', async (t) => {
  let blockNext;
  const { editor, newSlide } = await mountEditor(t, async (url) => {
    if (String(url).endsWith('/download')) return deck();
    return blockNext ? await blockNext : snapshot();
  });
  let resume;
  blockNext = new Promise((resolve) => {
    resume = resolve;
  });
  const poll = editor.refresh();
  let prepared = false;
  const preparation = editor.prepareTurn(new AbortController().signal).then((release) => {
    prepared = true;
    return release;
  });
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(prepared, false);
  assert.equal(newSlide.disabled, true);
  resume(snapshot());
  await poll;
  const release = await preparation;
  assert.equal(prepared, true);
  assert.equal(newSlide.disabled, true);
  blockNext = undefined;
  release();
  await editor.refresh();
  assert.equal(newSlide.disabled, false);
});

test('a deck switch or leave during a chat turn holds the pause alongside the turn', async (t) => {
  const { editor, newSlide } = await mountEditor(t, async (url) =>
    String(url).endsWith('/download') ? deck() : snapshot(),
  );
  const releaseTurn = await editor.prepareTurn(new AbortController().signal);
  const releaseLeave = await editor.prepareTurn(new AbortController().signal);
  releaseTurn();
  releaseTurn();
  await editor.refresh();
  assert.equal(newSlide.disabled, true);
  releaseLeave();
  await editor.refresh();
  assert.equal(newSlide.disabled, false);
});

test('an editor whose deck never loaded does not block chat sends', async (t) => {
  const { editor } = await mountEditor(t, async () => new Response('{}', { status: 404 }));
  const release = await editor.prepareTurn(new AbortController().signal);
  release();
  await editor.refresh();
});

test('a poll requested before an autosave committed does not report a conflict', async (t) => {
  let revision = '1',
    hold;
  const { editor } = await mountEditor(t, async (url) => {
    if (String(url).endsWith('/download')) return deck(revision);
    if (String(url).endsWith('/editor-save')) {
      revision = '2';
      return new Response(JSON.stringify({ version: revision }));
    }
    const read = snapshot(revision);
    if (hold) await hold;
    return read;
  });
  let resume;
  hold = new Promise((resolve) => {
    resume = resolve;
  });
  const poll = editor.refresh();
  await new Promise((resolve) => setTimeout(resolve));
  hold = undefined;
  engine.edits = 1;
  await engine.save();
  engine.edits = 2;
  resume();
  await poll;
  await editor.refresh();
  const release = await editor.prepareTurn(new AbortController().signal);
  release();
  await editor.refresh();
});

test('the editor root carries the chat theme, and no theme leaves it to the OS preference', async (t) => {
  const missing = async () => new Response('{}', { status: 404 });
  const { root: light } = await mountEditor(t, missing, { theme: 'light' });
  assert.equal(light.getAttribute('data-theme'), 'light');
  const { editor, root } = await mountEditor(t, missing);
  assert.equal(root.hasAttribute('data-theme'), false);
  editor.setTheme('dark');
  assert.equal(root.getAttribute('data-theme'), 'dark');
  editor.setTheme(undefined);
  assert.equal(root.hasAttribute('data-theme'), false);
});

/**
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 * Moved from amodalai/cloud packages/react/presentations/assets.mjs.
 */
import { createHash } from 'node:crypto';
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { webappDirectory, engineFile, noticeFiles, fontLicensesDirectory } from './index.mjs';

const integration = fileURLToPath(new URL('./editor/', import.meta.url));
const at = (file) => path.join(webappDirectory, file);
// Remove the completion marker before building so a failed build cannot be packaged as complete.
await rm(at('amodal-build.json'), { force: true });
const engineSha256 = createHash('sha256').update(await readFile(engineFile)).digest('hex');
const bundle = (entry, outfile, define) => build({
  entryPoints: [path.join(integration, entry)], bundle: true, format: 'esm', target: 'es2022',
  outfile: at(outfile), define, logLevel: 'silent',
});
// Asset-root bundles preserve upstream's import.meta.url worker and engine lookups.
await bundle('frame.js', 'amodal-editor.js');
await bundle('runtime.js', 'editor-runtime.js', {
  'import.meta.env.AMODAL_ENGINE_SHA256': JSON.stringify(engineSha256),
});
await cp(path.join(integration, 'amodal-editor.css'), at('amodal-editor.css'));
for (const file of noticeFiles) await cp(file, at(path.basename(file)));
await rm(at('font-licenses'), { recursive: true, force: true });
await cp(fontLicensesDirectory, at('font-licenses'), { recursive: true });
const page = (await readFile(at('editor.html'), 'utf8'))
  .replace(/<script type="module" src="\.\/editor\.js"><\/script>/,
    '<script type="module" src="./amodal-editor.js"></script>')
  .replace(/<\/head>/, '  <link rel="stylesheet" href="./amodal-editor.css" />\n  </head>');
if (!page.includes('src="./amodal-editor.js"') || !page.includes('href="./amodal-editor.css"'))
  throw new Error('Upstream editor.html changed shape; update npm/build-editor.mjs.');
await writeFile(at('amodal-editor.html'), page);
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}
const hash = createHash('sha256');
for (const file of await filesIn(webappDirectory)) {
  // Paths are portable and independent of the checkout/install location.
  hash.update(path.relative(webappDirectory, file).split(path.sep).join('/'));
  hash.update(await readFile(file));
}
await writeFile(at('amodal-build.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 20), engineSha256 }));

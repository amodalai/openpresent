# Amodal's fork of OpenPresent

This repository is Amodal's fork of
[CasualOffice/openpresent](https://github.com/CasualOffice/openpresent). It publishes the
web editor and its compiled engine to npm as `@amodalai/openpresent`, which the Amodal
chat widget embeds. Upstream does not publish an npm package.

Everything outside the files listed below is upstream code and is changed only by
merging upstream.

## Changes from upstream

The fork changes `webapp/editor.core.js` so the host boots the editor and owns persistence,
and `webapp/editor.text.js` so replacing selected text preserves destination formatting.
Both files carry a `Modified by Amodal` notice.

The fork adds these files, which upstream does not have:

- `package.json` and `npm/`: the npm package and its entry point.
- `.github/workflows/release-npm.yml`: builds the engine, packs the package, and publishes
  it on an `npm-v*` tag.
- `tests/unit/`: focused editor and packed-package regressions.
- `FORK.md`: this file.

It also adds the `npm-publish` job and the `npm-v*` tag to the tables in
`docs/15-CI-AND-RELEASE-GATES.md`, because upstream's `tools/check-workflows.py` fails on a
job or release tag that the document does not list.

With this change the editor no longer boots itself, publishes no global, and starts no
drafts, recent-file list, file picker or collaboration session. A host gives the editor a
page of its own, such as an iframe built from `webapp/editor.html`, calls `boot` from
`webapp/editor.core.js` in that page, and owns saving. The standalone `webapp/editor.html`
page is not a supported entry point of this fork.

## The package

The package contains `webapp/` with the compiled engine in `webapp/pkg/`, the Apache-2.0
`LICENSE` and `NOTICE`, the licences of the fonts compiled into the engine, and the existing
`schemas/` and production `tools/f4/` validation assets. Schemas retain their own third-party
terms in `NOTICE` and `schemas/README.md`; the package does not relicense them. Its entry
point exports the paths a host build needs:

```js
import { webappDirectory, engineFile, noticeFiles, fontLicensesDirectory, validationDirectory } from '@amodalai/openpresent';
```

`validationDirectory` is the installed package root containing `schemas/` and
`tools/f4/validate.py`. Hosts copy those assets and `noticeFiles` into their isolated
execution environment. Validation requires Python 3 and `xmllint`; it performs no schema
downloads. Validators are outside `webapp/` and are not browser assets.

Modules are also importable by path, for example
`@amodalai/openpresent/webapp/editor.core.js`, so a host bundler can compile the editor
into its own bundle.

The engine is not committed. CI builds it with the toolchain in `rust-toolchain.toml` and
wasm-pack 0.14.0, and records its SHA-256 in the run summary. A presentation service that
checks the editor's engine digest must run the engine from the same package version.

## Syncing upstream

```sh
git remote add upstream https://github.com/CasualOffice/openpresent.git
git fetch upstream
git merge upstream/main
```

Resolve conflicts in `webapp/editor.core.js` so it keeps its Amodal behaviour. Then bump
the version and release.

## Releasing

1. Set `version` in `package.json` and commit it.
2. Push a tag named `npm-v` plus that version, for example `npm-v0.1.1`.
3. The `release-npm` workflow builds the engine and publishes the package. It runs in the
   `release` environment, which needs an `NPM_TOKEN` secret with publish rights on the
   `@amodalai` scope.

A manual run of `release-npm` builds and packs without publishing unless `dry_run` is set
to false.

## Upstream workflows

`ci` and `post-merge` check the engine and the repository gates after each upstream merge.
Disable the others in the fork:

- `pages` would deploy upstream's public site from the fork.
- `desktop` and `collab` drive the standalone editor page, which the fork's changes stop
  booting.
- `fuzz` and `phase1-exit` test the engine, which the fork does not change, and upstream
  already runs them.

```sh
for w in pages desktop collab fuzz phase1-exit; do gh workflow disable "$w" -R amodalai/openpresent; done
```

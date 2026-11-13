/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
// Amodal owns the session and lifecycle; OpenPresent owns the canvas commands.
import { boot, openDeck, request, editsNow, state } from '../../webapp/editor.core.js';
import { command, run, register, registeredIds } from '../../webapp/commands.js';
import { go } from '../../webapp/editor.slides.js';
export async function mount(options) {
  await boot();
  options.signal.throwIfAborted();
  const base = options.apiUrl;
  // The host's fetch handles its sign-in redirect; the signal ends calls when the editor closes.
  const deckFetch = (url, init) => (options.fetch ?? fetch)(url, { ...init, signal: options.signal });
  // No theme leaves the root to OpenPresent's prefers-color-scheme rule.
  const setTheme = (theme) => {
    if (theme) document.documentElement.dataset.theme = theme;
    else document.documentElement.removeAttribute('data-theme');
  };
  setTheme(options.theme);
  const toolbar = document.createElement('header');
  toolbar.className = 'amodal-toolbar';
  toolbar.setAttribute('aria-label', 'Presentation tools');
  document.body.prepend(toolbar);
  const label = document.createElement('span');
  label.className = 'amodal-save-state';
  label.setAttribute('role', 'status');
  let baseline = 0,
    version,
    loaded = false,
    saving = false,
    downloading = false,
    lastError = '';
  let agentBusy = false,
    holds = 0,
    saveError = '',
    savePromise,
    saveTimer,
    observedEdits = 0,
    saves = 0;
  let sequence = 0,
    syncing = false,
    conflict = false;
  const dirty = () => loaded && !syncing && editsNow() !== baseline;
  const canEdit = () => loaded && !agentBusy && !holds && !syncing && !conflict && !lastError;
  const icons = {
    undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12',
    redo: 'm15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12',
    slide: 'M3 5h18v14H3zM12 8v8m-4-4h8',
    text: 'M4 5h16M12 5v15M8 20h8',
    shape: 'M5 5h14v14H5z',
    image: 'M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4M16 8h.01',
    play: 'm8 4 12 8-12 8z',
    fit: 'M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5',
    bold: 'M7 4h6a4 4 0 0 1 0 8H7m0-8v16h7a4 4 0 0 0 0-8',
    tools: 'M4 6h16M4 12h16M4 18h16',
    save: 'M5 3h12l4 4v14H3V3h2m2 0v6h10V3M7 21v-8h10v8',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  };
  function button(title, icon, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(svg.namespaceURI, 'path');
    p.setAttribute('d', icons[icon]);
    svg.append(p);
    b.append(svg);
    // Preserve the native text selection when formatting from the toolbar.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () =>
      Promise.resolve(action()).catch((e) => {
        lastError = e.message;
        label.textContent = lastError;
      }),
    );
    toolbar.append(b);
    return b;
  }
  const bindings = [
    ['Undo', 'undo', 'edit.undo'],
    ['Redo', 'redo', 'edit.redo'],
    ['New slide', 'slide', 'home.new-slide'],
    ['Text box', 'text', 'insert.text-box'],
    ['Rectangle', 'shape', 'insert.shape.rectangle'],
    ['Picture', 'image', 'insert.pictures'],
    ['Bold', 'bold', 'font.bold'],
    ['Fit slide', 'fit', 'view.zoom.fit'],
    ['Present', 'play', 'slideshow.from-beginning'],
  ].map(([title, icon, id]) => ({
    id,
    button: button(title, icon, () => {
      if (canEdit() || (loaded && !syncing && id.startsWith('view.'))) return run(id);
    }),
  }));
  const more = button('More tools', 'tools', () => {
    if (!canEdit()) return;
    document.body.classList.toggle('amodal-more');
    window.dispatchEvent(new Event('resize'));
  });
  async function saveChanges() {
    if (savePromise) return savePromise;
    if (!dirty()) return;
    if (agentBusy || conflict || syncing)
      throw new Error('The deck is busy or has changed. Your unsaved edits are still here.');
    savePromise = (async () => {
      saving = true;
      saves++;
      saveError = '';
      updateUI();
      try {
        const snapshot = await request({ op: 'save' });
        const response = await deckFetch(`${base}/editor-save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Deck-Version': version },
          body: snapshot.bytes,
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 409) conflict = true;
          throw new Error(result.error ?? 'Save failed');
        }
        version = result.version;
        baseline = snapshot.editsNow;
      } catch (error) {
        saveError = 'Couldn’t save — Retry. ' + error.message;
        throw error;
      } finally {
        saving = false;
        savePromise = null;
        if (dirty() && !saveError && !holds && !agentBusy && !conflict) {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            void saveChanges().catch(() => {});
          }, 800);
        }
        updateUI();
      }
    })();
    return savePromise;
  }
  const retry = button('Retry saving', 'save', () => saveChanges());
  retry.hidden = true;
  function scheduleSave() {
    const current = editsNow();
    if (!loaded || current === observedEdits) return;
    observedEdits = current;
    clearTimeout(saveTimer);
    if (!dirty() || agentBusy || holds || conflict || saveError) return;
    saveTimer = setTimeout(() => {
      void saveChanges().catch(() => {});
    }, 800);
  }
  async function downloadPowerPoint() {
    if (!loaded || syncing || downloading) return;
    downloading = true;
    updateUI();
    try {
      const snapshot = await request({ op: 'save' });
      // Embedded browsers need a regular HTTP download URL, not a blob URL.
      // Stage the current snapshot briefly without saving over the stored deck.
      const response = await deckFetch(`${base}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: snapshot.bytes,
      });
      if (!response.ok) throw new Error('Could not prepare the download. Please try again.');
      const { downloadUrl } = await response.json();
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.target = '_top';
      link.download = 'amodal-presentation.pptx';
      document.body.append(link);
      link.click();
      link.remove();
    } finally {
      downloading = false;
      updateUI();
    }
  }
  const download = button('Download PowerPoint', 'download', downloadPowerPoint);
  // File-level ownership belongs to the host. Keep native keyboard/menu saves
  // consistent with autosave, and never start a separate collaboration session.
  for (const id of registeredIds()) {
    if (typeof id !== 'string') continue;
    if (['file.new', 'file.open', 'file.share'].includes(id) || id.startsWith('file.new.template.'))
      register(id, { label: command(id)?.label ?? id, enabled: () => false, run() {} });
  }
  register('file.save', { label: 'Save', shortcut: 'Ctrl+S', enabled: canEdit, run: saveChanges });
  for (const id of ['file.save-as', 'file.save-copy'])
    register(id, {
      label: 'Download PowerPoint',
      enabled: () => loaded && !syncing && !downloading,
      run: downloadPowerPoint,
    });
  for (const type of ['dragover', 'drop'])
    window.addEventListener(type, (event) => {
      if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault();
    });
  toolbar.append(label);
  const note = document.createElement('div');
  note.className = 'amodal-editor-note';
  note.textContent = 'Changes save automatically.';
  toolbar.after(note);

  function updateUI() {
    const editable = canEdit();
    for (const entry of bindings)
      entry.button.disabled =
        (!editable && !(loaded && !syncing && entry.id.startsWith('view.'))) || !command(entry.id)?.enabled();
    more.disabled = !editable;
    retry.hidden = !saveError;
    retry.disabled = saving || agentBusy || conflict;
    download.disabled = !loaded || syncing || downloading;
    document.getElementById('stage').inert = !editable;
    document.getElementById('notes-pane').inert = !editable;
    document.querySelector('.bottom-bar')?.toggleAttribute('inert', !editable);
    document.querySelector('.op-ribbon')?.toggleAttribute('inert', !editable);
    if (!editable) document.body.classList.remove('amodal-more');
    label.textContent =
      saveError ||
      lastError ||
      (downloading ? 'Preparing download…' : '') ||
      (conflict
        ? 'The deck changed. Download your unsaved edits before reconnecting.'
        : saving
          ? 'Saving…'
          : agentBusy
            ? `Agent is editing… · ${state.deck?.count ?? 0} slides · ${sequence} edits`
            : holds
              ? 'Preparing for the agent…'
              : syncing
                ? 'Updating slides…'
                : dirty()
                  ? 'Changes pending…'
                  : `Saved · ${state.deck?.count ?? 0} slides`);
    note.textContent =
      agentBusy || holds
        ? 'The agent is editing. You can browse slides and download a copy. Editing unlocks when it finishes or stops.'
        : 'Changes save automatically. Download PowerPoint saves a copy to your computer.';
  }
  // The upstream editor owns keyboard shortcuts and drag/drop at document level.
  // Block those as well as pointer editing while an agent checkpoint is being applied.
  for (const type of [
    'click',
    'pointerdown',
    'mousedown',
    'dblclick',
    'contextmenu',
    'dragstart',
    'keydown',
    'beforeinput',
    'paste',
    'cut',
    'drop',
    'dragover',
  ]) {
    window.addEventListener(
      type,
      (event) => {
        if (canEdit() || event.target?.closest?.('.amodal-toolbar') || (type === 'keydown' && event.key === 'Tab'))
          return;
        if (type === 'click') {
          const thumb = event.target?.closest?.('#thumbs [data-index]');
          if (thumb && loaded) go(Number(thumb.dataset.index));
        }
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }

  let pending = false;
  let refreshPromise;
  function refresh() {
    pending = true;
    if (refreshPromise) return refreshPromise;
    if (saving) return Promise.resolve();
    refreshPromise = refreshNow().finally(() => {
      refreshPromise = undefined;
    });
    return refreshPromise;
  }
  async function refreshNow() {
    try {
      while (pending && !saving) {
        pending = false;
        const savesAtRequest = saves;
        const response = await deckFetch(base, { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not refresh the presentation. Reconnecting…');
        const snapshot = await response.json();
        // The server may have read this revision before a save that started meanwhile committed.
        if (savesAtRequest !== saves) {
          pending = true;
          continue;
        }
        if (snapshot.engineId !== options.engineSha256)
          throw new Error('The editor and presentation service use different engine versions. Update them together.');
        const nextVersion = snapshot.nativeRevision ?? `events-${snapshot.events.length}`;
        agentBusy = snapshot.agentBusy === true;
        if (nextVersion === version) {
          lastError = '';
          updateUI();
          continue;
        }
        if (dirty()) {
          conflict = true;
          updateUI();
          continue;
        }
        if (!snapshot.events.length) {
          updateUI();
          continue;
        }
        syncing = true;
        updateUI();
        const file = await deckFetch(`${base}/download`, { cache: 'no-store' });
        if (!file.ok) throw new Error('Could not refresh the slide content. Reconnecting…');
        const next = file.headers.get('X-Deck-Version');
        if (!next) throw new Error('The saved deck is missing its version.');
        // The server pairs these headers and bytes under the same deck lock.
        const bytes = await file.arrayBuffer();
        await openDeck('Amodal presentation.pptx', bytes);
        version = next;
        agentBusy = file.headers.get('X-Agent-Busy') === 'true';
        sequence = Number(file.headers.get('X-Presentation-Sequence'));
        baseline = editsNow();
        observedEdits = baseline;
        loaded = true;
        conflict = false;
        lastError = '';
        state.notes = false;
        document.getElementById('notes-pane').hidden = true;
        // Follow the slide the agent just changed, while retaining the editor instance.
        const index = snapshot.events.at(-1)?.result?.index ?? 0;
        if (state.deck?.count) go(Math.min(index, state.deck.count - 1));
        document.title = 'Amodal presentation editor';
        syncing = false;
        updateUI();
      }
    } catch (error) {
      lastError = error.message;
    } finally {
      syncing = false;
      updateUI();
    }
  }
  async function prepareTurn(signal) {
    document.activeElement?.blur();
    let held = true;
    holds++;
    clearTimeout(saveTimer);
    updateUI();
    const release = () => {
      if (!held) return;
      held = false;
      holds--;
      signal.removeEventListener('abort', release);
      void refresh();
      updateUI();
    };
    signal.addEventListener('abort', release, { once: true });
    try {
      signal.throwIfAborted();
      // A background poll must not make an otherwise ready chat send fail.
      while (refreshPromise) await refreshPromise;
      signal.throwIfAborted();
      if (!loaded) {
        signal.removeEventListener('abort', release);
        return release;
      }
      if (conflict) throw new Error('The deck changed in another tab. Download your edits before reopening.');
      if (savePromise) await savePromise;
      await request({ op: 'save' });
      while (dirty()) {
        signal.throwIfAborted();
        await saveChanges();
      }
      signal.throwIfAborted();
      // Navigation or agent completion owns release after preparation succeeds.
      signal.removeEventListener('abort', release);
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }
  updateUI();
  void refresh();

  // Recover missed chat events, reconnects, and a restored conversation.
  setInterval(() => {
    if (!saving) void refresh();
  }, 3000);
  setInterval(() => {
    scheduleSave();
    updateUI();
  }, 250);
  window.addEventListener('beforeunload', (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  return {
    refresh,
    prepareTurn,
    setTheme,
  };
}

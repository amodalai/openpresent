/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
// Each editor gets its own page, so OpenPresent's page-level styles, keys, timers,
// workers, print and Presenter View stay inside it. Removing the frame stops them all.
export async function mountEditor(host, options) {
  const frame = host.ownerDocument.createElement('iframe');
  frame.title = 'Presentation editor';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  frame.src = new URL('amodal-editor.html', options.assetsUrl).href;
  const gone = new AbortController();
  const destroy = () => {
    frame.remove();
    gone.abort(new Error('Presentation editor closed'));
  };
  // A removed frame stops running, so its pending promises would never settle.
  const closed = new Promise((_, reject) =>
    gone.signal.addEventListener('abort', () => reject(gone.signal.reason), { once: true }),
  );
  closed.catch(() => {});
  // Errors from the frame's realm fail the host's `instanceof Error` checks.
  const whileOpen = (promise) =>
    Promise.race([promise, closed]).catch((error) => {
      if (error instanceof Error) throw error;
      throw Object.assign(new Error(error?.message ?? String(error)), { name: error?.name ?? 'Error' });
    });
  options.signal.addEventListener('abort', destroy, { once: true });
  host.replaceChildren(frame);
  if (options.signal.aborted) destroy();
  try {
    await whileOpen(new Promise((resolve) => frame.addEventListener('load', resolve, { once: true })));
    const editor = frame.contentWindow?.amodalPresentationEditor;
    if (!editor) throw new Error('Could not load the presentation editor.');
    const controller = await whileOpen(
      editor.mount({ ...options, engineSha256: import.meta.env.AMODAL_ENGINE_SHA256 }),
    );
    return {
      refresh: () => whileOpen(controller.refresh()),
      async prepareTurn(signal) {
        const release = await whileOpen(controller.prepareTurn(signal));
        return () => {
          if (!gone.signal.aborted) release();
        };
      },
      setTheme: (theme) => controller.setTheme(theme),
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}

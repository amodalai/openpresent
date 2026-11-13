import { fileURLToPath } from 'node:url';

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export const webappDirectory = at('../webapp');
export const engineFile = at('../webapp/pkg/casual_slide_wasm_bg.wasm');
export const noticeFiles = [at('../LICENSE'), at('../NOTICE')];
export const fontLicensesDirectory = at('../crates/casual-slide-text/fonts/LICENSES');

// Root containing schemas/ and tools/f4/; consumed by isolated validation services.
export const validationDirectory = at('..');

// Complete prebuilt embedded editor; hosts copy these files without a bundler.
export const assetsDirectory = webappDirectory;

import { fileURLToPath } from 'node:url';

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export const webappDirectory = at('../webapp');
export const engineFile = at('../webapp/pkg/casual_slide_wasm_bg.wasm');
export const noticeFiles = [at('../LICENSE'), at('../NOTICE')];
export const fontLicensesDirectory = at('../crates/casual-slide-text/fonts/LICENSES');

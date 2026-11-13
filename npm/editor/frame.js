/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
import { mount } from './amodal-editor.js';

// The host reaches this page's editor through the frame's window; both share an origin.
window.amodalPresentationEditor = { mount };

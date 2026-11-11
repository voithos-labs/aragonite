// The parts the range-edit checks read Markdown with: every bundled plugin that adds syntax,
// installed inside each test (the setup resets the platform between tests), the editor's reading
// over them, and the host the core reads through, with what a block's text shows on screen.

import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { visibleText } from '#lib/core/inline/link-source-bytes.js';
import { hidesDelimitersAtCaret } from '#lib/presentation-mode.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import type { Reading } from '#lib/schema/reading.js';
import { kitReading } from '#lib/testing/kit-reading.js';
import { rangeHost, type Mode, type PasteHost, type RangeHost } from '#lib/range-edit/host.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';

const PLUGINS = [...SYNTAX_PLUGINS, mermaidPlugin()];

/** The reading an editor with every bundled syntax plugin reads with; call it inside a test. */
export function testReading(): Reading {
	installPlugins(PLUGINS);
	return kitReading();
}

/** `host` as a paste reads through it in an editor that registered no paste transform. */
export const noTransforms = (host: RangeHost): PasteHost => ({
	...host,
	transformPaste: (text) => text
});

/** The host, and what text shows on screen in a mode, which law 11 reads. */
export interface CheckHost extends PasteHost {
	shows(text: string, mode: Mode): string;
}

export function checkHost(reading: Reading = testReading()): CheckHost {
	const shows = (text: string, mode: Mode) =>
		visibleText(text, {
			...reading,
			mode: () => mode,
			hidesDelimitersAtCaret: () => hidesDelimitersAtCaret(mode)
		});
	return { ...noTransforms(rangeHost(reading)), shows };
}

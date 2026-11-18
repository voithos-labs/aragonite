// @vitest-environment jsdom
// A clipboard that opens with a line ending at a heading's text start takes the heading down with
// its text, as Enter there does, and the rest of the clipboard goes in at the text start: `# ‸Title`
// + `\n===` is `\n# ===Title`. ATX with and without a closing run, in a quote and an item; a setext
// title holds lines already. Live mode, where Enter keeps the caret in the text, is the parity row.
// Miss-analysis: ruling 34's rows opened with a blank line, which takes the gap branch, so no row
// opened with one line ending, which the heading's own write split under an empty `# `.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted at `‸` (or, with none, Enter pressed there), then `keys`: the bytes, no dev check. */
async function landed(marked: string, mode: PresentationMode, clip: string | null, keys = '') {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
	const key = async (k: string) => {
		await pressHardwareKey(document.activeElement as HTMLElement, { key: k });
		await editor.settle();
	};
	if (clip === null) await key('Enter');
	else await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	for (const k of keys) await key(k);
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const left = editor.source();
	await destroyMountedEditors();
	return left;
}

const ATX = '# ‸Title here\n\nAfter\n';

// [name, marked, clipboard, the bytes], in both modes.
const ROWS: [string, string, string, string][] = [
	['a setext line', ATX, '\n===', '\n# ===Title here\n\nAfter\n'],
	['text', ATX, '\nx', '\n# xTitle here\n\nAfter\n'],
	['a line ending alone', ATX, '\n', '\n# Title here\n\nAfter\n'],
	['a blank line, then text', ATX, '\n\nx', '\n\n# xTitle here\n\nAfter\n'],
	[
		'a setext line, a closing run',
		'# ‸Title here #\n\nAfter\n',
		'\n===',
		'\n# ===Title here #\n\nAfter\n'
	],
	[
		'a setext line, in a quote',
		'> # ‸Title here\n>\n> After\n',
		'\n===',
		'>\n> # ===Title here\n>\n> After\n'
	],
	['text, in a quote', '> # ‸Title here\n>\n> After\n', '\nx', '>\n> # xTitle here\n>\n> After\n'],
	[
		'a setext line, in an item',
		'- # ‸Title here\n- After\n',
		'\n===',
		'- \n  # ===Title here\n- After\n'
	],
	[
		'a setext line, a setext title',
		'‸Title here\n===\n\nAfter\n',
		'\n===',
		'\n===Title here\n===\n\nAfter\n'
	],
	['text, mid-heading', '# Ti‸tle here\n\nAfter\n', '\nx', '# Ti\nxtle here\n\nAfter\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, want] of ROWS)
		it(`${mode}: ${name} opening with a line ending at the heading's text start`, async () => {
			expect(await landed(marked, mode, clip)).toBe(want);
		});

it('live: a line ending alone is Enter at the heading’s text start, and text after it the next letters', async () => {
	expect(await landed(ATX, 'live', '\n', 'Z')).toBe(await landed(ATX, 'live', null, 'Z'));
	expect(await landed(ATX, 'live', '\nx', 'Z')).toBe(await landed(ATX, 'live', null, 'xZ'));
});

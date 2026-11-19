// @vitest-environment jsdom
// Text pasted on a line of only spaces right over an indented code block keeps a blank line from
// the code, which a reload would otherwise read into the pasted paragraph; the commit lands the
// core's answer, so no dev check fires. Over a range that leaves such a line, and on one a cut left.
// Miss-analysis: the empty-line rows' lines held no spaces, and a seed drew the one shape where the
// block's own write set the code apart and the core's answer did not.
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
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { clipboardGesture, mountCase, pasteGesture, placeOwnedRange } from '../range-laws/gestures';

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

/** `⟦…⟧` marks the range; `after` is the source the paste leaves. */
const ROWS: [name: string, marked: string, text: string, after: string][] = [
	[
		'over a heading between two code blocks',
		'  ⟦  a\n# h\n⟧    b\n\nlast\n',
		'ж',
		'  ж\n\n    b\n\nlast\n'
	],
	[
		'over a rule, CRLF',
		'intro\r\n\r\n  ⟦  a\r\n***\r\n⟧    b\r\n',
		'ж',
		'intro\r\n\r\n  ж\r\n\r\n    b\r\n'
	],
	['two words over a rule', '  ⟦  a\n***\n⟧    b\n', 'x y', '  x y\n\n    b\n'],
	// A seed found it: spaces that indent the text into code leave it the code's own line.
	['four spaces, the text a code line', '    ⟦a\n# h\n⟧    b\n', 'ж', '    ж\n    b\n'],
	['a tab, the text a code line', '\t⟦a\n# h\n⟧    b\n', 'ж', '\tж\n    b\n']
];

async function placed(marked: string, mode: PresentationMode) {
	const editor = mountCase(marked.replace(/[⟦⟧]/g, ''), mode);
	await editor.settle();
	const m = measured(editor.instance.__test.getDocument());
	const anchor = pointAtByte(m, marked.indexOf('⟦'))!;
	const focus = pointAtByte(m, marked.indexOf('⟧') - 1)!;
	expect(await placeOwnedRange(editor, { anchor, focus })).toBe(true);
	takeDevWarns();
	return editor;
}

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, text, after] of ROWS) {
		it(`${mode}: ${name}`, async () => {
			const editor = await placed(marked, mode);
			await pasteGesture(editor, { 'text/plain': text }, 'key');
			expect(editor.source()).toBe(after);
			expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
		});
		it(`${mode}: ${name}, cut first, then pasted at the cut's caret`, async () => {
			const editor = await placed(marked, mode);
			await clipboardGesture(editor, 'cut', 'key');
			await pasteGesture(editor, { 'text/plain': text }, 'key');
			expect(editor.source()).toBe(after);
			expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
		});
	}

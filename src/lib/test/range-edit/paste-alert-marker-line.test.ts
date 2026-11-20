// @vitest-environment jsdom
// A paste at an alert's marker line with no line under it lands in the body a typed letter opens
// there, never on the marker line, which would unmake the alert.
// Miss-analysis: every alert row had a body line under the marker, where the caret already sits;
// the marker line alone holds the empty body block on its own line's ending.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange, type Editor } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** The source after `act` at `‸`, then after `Z` is typed; no dev check may fire. */
async function after(
	marked: string,
	mode: PresentationMode,
	act: (editor: Editor) => Promise<unknown>
) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await act(editor);
	await editor.settle();
	const done = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const typed = editor.source();
	await destroyMountedEditors();
	return [done, typed];
}

/** `‸` marks the caret; `pasted` is the source the paste leaves, `typed` it once `Z` is typed. */
const ROWS: [name: string, marked: string, clip: string, pasted: string, typed: string][] = [
	['text', '> [!NOTE]‸\n', 'x', '> [!NOTE]\n> x\n', '> [!NOTE]\n> xZ\n'],
	[
		'a list',
		'> [!NOTE]‸\n',
		'- one\n- two',
		'> [!NOTE]\n> - one\n> - two\n',
		'> [!NOTE]\n> - one\n> - twoZ\n'
	],
	['a heading', '> [!NOTE]‸\n', '# h', '> [!NOTE]\n> # h\n', '> [!NOTE]\n> # hZ\n'],
	[
		'two paragraphs',
		'> [!NOTE]‸\n',
		'x\n\ny',
		'> [!NOTE]\n> x\n>\n> y\n',
		'> [!NOTE]\n> x\n>\n> yZ\n'
	],
	[
		'text with its ending, as Enter',
		'> [!NOTE]‸\n',
		'x\n',
		'> [!NOTE]\n> x\n>\n>\n',
		'> [!NOTE]\n> x\n>\n> Z\n'
	],
	['text at an open file’s end', '> [!NOTE]‸', 'x', '> [!NOTE]\n> x', '> [!NOTE]\n> xZ'],
	[
		'a list at an open file’s end',
		'> [!NOTE]‸',
		'- one\n- two',
		'> [!NOTE]\n> - one\n> - two',
		'> [!NOTE]\n> - one\n> - twoZ'
	],
	[
		'text over a paragraph',
		'> [!TIP]‸\n\nafter\n',
		'x',
		'> [!TIP]\n> x\n\nafter\n',
		'> [!TIP]\n> xZ\n\nafter\n'
	],
	// A seed found it: a body line of markers alone on the open last line is the body's already.
	[
		'text on an open body line',
		'> [!NOTE]\n   > ‸',
		'x',
		'> [!NOTE]\n   > x',
		'> [!NOTE]\n   > xZ'
	],
	// Miss-analysis: every quote row ended its file on a line break; at an open end the line's
	// own text was read from the line's start, so an item's marker passed for an alert's title.
	['text in an item’s empty quote at an open end', '- > ‸', 'x', '- > x', '- > xZ'],
	['text in an empty quote two deep at an open end', '> - > ‸', 'x', '> - > x', '> - > xZ'],
	[
		'text in an item',
		'- > [!NOTE]‸\n- b\n',
		'x',
		'- > [!NOTE]\n  > x\n- b\n',
		'- > [!NOTE]\n  > xZ\n- b\n'
	],
	[
		'a heading in a quote',
		'> > [!NOTE]‸\n>\n> after\n',
		'# h',
		'> > [!NOTE]\n> > # h\n>\n> after\n',
		'> > [!NOTE]\n> > # hZ\n>\n> after\n'
	]
];

for (const mode of ['source', 'live'] as const) {
	for (const [name, marked, clip, pasted, typed] of ROWS)
		it(`${mode}: ${name} lands in the body`, async () => {
			const paste = (editor: Editor) => pasteGesture(editor, { 'text/plain': clip }, 'key');
			expect(await after(marked, mode, paste)).toEqual([pasted, typed]);
		});
	it(`${mode}: a typed letter lands there too`, async () => {
		const letter = () => insertBy('hardware key', document.activeElement as HTMLElement, 'x');
		expect(await after('> [!NOTE]‸\n', mode, letter)).toEqual([
			'> [!NOTE]\n> x\n',
			'> [!NOTE]\n> xZ\n'
		]);
	});
}

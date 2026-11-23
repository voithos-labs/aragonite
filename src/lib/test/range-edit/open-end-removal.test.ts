// @vitest-environment jsdom
// A range the editor holds, removed at a file's open end, leaves what it leaves in the same file
// with a final line break, the emptied last line keeping its break; the letter and the paste back
// after it give the twin's bytes too, and the warn gate catches a final break gained on text.
// Miss-analysis: every range-core removal row ended its fixture in a line break, or kept text on
// the last line, so no row emptied a last line under other lines at an open end.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import {
	clipboardGesture,
	mountCase,
	pasteGesture,
	placeOwnedRange,
	type Editor
} from '#lib/test/range-laws/gestures.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorSelection } from '#lib/selection/primitives.js';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['source', 'live'];
const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;
const at = (path: number[], offset: number) => ({ path, offset });

// [name, open source, the range]: a finger's range in one block, or a range across blocks.
const ROWS: [string, string, EditorSelection][] = [
	['a paragraph’s second line', 'above\npq', { anchor: at([0], 6), focus: at([0], 8) }],
	['an unclosed code body’s last line', 'zz\n\n```\npq', { anchor: at([1], 4), focus: at([1], 6) }],
	['across blocks to the end', 'above\nb\n\nzz', { anchor: at([0], 6), focus: at([1], 2) }],
	['a last paragraph across blocks', 'above\n\nb\n\nzz', { anchor: at([1], 0), focus: at([2], 2) }]
];

type Gesture = (editor: Editor) => Promise<unknown>;
const GESTURES: [string, Gesture][] = [
	['Delete', () => pressHardwareKey(focused(), { key: 'Delete' })],
	['a cut, then a letter', (editor) => clipboardGesture(editor, 'cut', 'key')],
	[
		'a cut, then the paste back',
		async (editor) => pasteGesture(editor, await clipboardGesture(editor, 'cut', 'key'), 'key')
	]
];

/** The bytes after the gesture over `range` in `source`, then after a letter where it takes one. */
async function after(source: string, mode: PresentationMode, range: EditorSelection, name: string) {
	const editor = mountCase(source, mode);
	await editor.settle();
	expect(await placeOwnedRange(editor, range)).toBe(true);
	await GESTURES.find(([gesture]) => gesture === name)![1](editor);
	await editor.settle();
	const left = editor.source();
	if (name.endsWith('paste back')) return [left];
	await insertBy('hardware key', focused(), 'x');
	await editor.settle();
	return [left, editor.source()];
}

describe('a removal at an open end leaves its twin’s bytes', () => {
	for (const [row, source, range] of ROWS)
		for (const mode of MODES)
			for (const [gesture] of GESTURES)
				it(`${row}, ${gesture}, ${mode}`, async () => {
					const twin = await after(`${source}\n`, mode, range, gesture);
					await destroyMountedEditors();
					expect(await after(source, mode, range, gesture)).toEqual(twin);
				});
});

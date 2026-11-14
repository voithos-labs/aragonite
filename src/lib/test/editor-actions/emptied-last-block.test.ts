// @vitest-environment jsdom
// Emptying the document's last block over its whole text, by every key that does it, or opening a
// blank block under it: the trailing blank line below goes, as the blank line under any blank block
// goes, so a reload reads the blank blocks the screen shows and a letter typed next stands alone.
// Miss-analysis: the fix-up's tail rows asked only that the tree reload as itself, and no mounted
// row typed into a blank last block, so the second blank block under `x` went unseen; and none
// emptied a list item over a table, where dropping the item's line joined the two on reload.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchPaste, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type Editor = MountedEditor<EditorTestSurface>;
type Gesture = 'Backspace' | 'Delete' | 'cut' | 'space';
type Step = 'Enter' | 'paste';

/** A scripted cut with a clipboard that takes what the editor writes. */
function cut(target: EventTarget): void {
	const e = new Event('cut', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', { value: { setData: () => {}, getData: () => '' } });
	target.dispatchEvent(e);
}

/** A delete key the editor leaves to the browser, done as a browser does it: jsdom has no engine. */
function browserDelete(focused: HTMLElement, key: 'Backspace' | 'Delete'): void {
	window.getSelection()!.getRangeAt(0).deleteContents();
	const inputType = key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward';
	focused.dispatchEvent(new InputEvent('input', { inputType, bubbles: true }));
}

async function press(editor: Editor, gesture: Gesture | Step | 'x'): Promise<string> {
	const focused = document.activeElement as HTMLElement;
	if (gesture === 'cut') cut(focused);
	else if (gesture === 'paste') dispatchPaste(focused, '\n\n');
	else {
		const key = gesture === 'space' ? ' ' : gesture;
		const outcome = await pressHardwareKey(focused, { key });
		if (outcome === 'browser' && (key === 'Backspace' || key === 'Delete'))
			browserDelete(focused, key);
	}
	await editor.settle();
	// An empty document holds one empty block, which a parse of no bytes doesn't.
	if (editor.source() !== '')
		expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	return editor.source();
}

/** Mounts `source`, selects `[from, to)` of the block at `path`, runs the gesture, then types `x`. */
async function emptyThenType(
	source: string,
	mode: PresentationMode,
	[path, from, to]: [number[], number, number],
	gesture: Gesture
): Promise<[string, string]> {
	const editor = mountEditor<EditorTestSurface>({ source, presentationMode: mode });
	await editor.settle();
	selectRange(surfaceAt(editor, path), from, to);
	await editor.settle();
	return [await press(editor, gesture), await press(editor, 'x')];
}

const MODES: PresentationMode[] = ['live', 'source'];
const EMPTYING: Gesture[] = ['Backspace', 'Delete', 'cut'];

describe('the trailing blank line under an emptied last block goes', () => {
	// [name, source, modes, selection, after the gesture, after `x`]
	const ROWS: [string, string, PresentationMode[], [number[], number, number], string, string][] = [
		['a paragraph', 'ab\n\n', MODES, [[0], 0, 2], '\n', 'x\n'],
		['a CRLF paragraph', 'ab\r\n\r\n', MODES, [[0], 0, 2], '\r\n', 'x\r\n'],
		['a live heading', '# ab\n\n', ['live'], [[0], 2, 4], '\n', 'x\n'],
		[
			'a live heading under a paragraph',
			'zz\n\n# ab\n\n',
			['live'],
			[[1], 2, 4],
			'zz\n\n\n',
			'zz\n\nx\n'
		],
		['a quote ending on a bare `>` line', '> ab\n>\n', MODES, [[0, 0], 0, 2], '>\n', '> x\n']
	];
	for (const [name, source, modes, selection, emptied, typed] of ROWS)
		for (const mode of modes)
			for (const gesture of EMPTYING)
				it(`${name}, ${mode}, ${gesture}`, async () => {
					expect(await emptyThenType(source, mode, selection, gesture)).toEqual([emptied, typed]);
				});

	it.each(MODES)('a space typed over a paragraph, %s', async (mode) => {
		expect(await emptyThenType('ab\n\n', mode, [[0], 0, 2], 'space')).toEqual([' \n', ' x\n']);
	});

	it.each(MODES)('undo gives the line back with the text, %s', async (mode) => {
		const editor = mountEditor<EditorTestSurface>({ source: '> ab\n>\n', presentationMode: mode });
		await editor.settle();
		selectRange(surfaceAt(editor, [0, 0]), 0, 2);
		await editor.settle();
		expect(await press(editor, 'Delete')).toBe('>\n');
		await pressHardwareKey(document.activeElement as HTMLElement, { key: 'z', ctrlKey: true });
		await editor.settle();
		expect(editor.source()).toBe('> ab\n>\n');
	});
});

// Enter or a paste that opens a blank block at the end meets the same line: one Enter, one line.
describe('a blank block opened under the last block takes no second line', () => {
	// [name, source, modes, caret, steps, after the steps, after `x`]
	const ROWS: [string, string, PresentationMode[], [number[], number], Step[], string, string][] = [
		['Enter after a paragraph', 'ab\n\n', MODES, [[0], 2], ['Enter'], 'ab\n\n\n', 'ab\n\nx\n'],
		[
			'Enter after a live heading',
			'# ab\n\n',
			['live'],
			[[0], 4],
			['Enter'],
			'# ab\n\n\n',
			'# ab\n\nx\n'
		],
		[
			'Enter in a quote over a bare `>`',
			'> ab\n>\n',
			MODES,
			[[0, 0], 2],
			['Enter'],
			'> ab\n>\n>\n',
			'> ab\n>\n> x\n'
		],
		[
			'Enter twice out of an item',
			'- ab\n\n',
			MODES,
			[[0, 0, 0], 2],
			['Enter', 'Enter'],
			'- ab\n\n\n',
			'- ab\n\nx\n'
		],
		['two line breaks pasted', 'ab\n\n', MODES, [[0], 2], ['paste'], 'ab\n\n\n\n', 'ab\n\n\nx\n']
	];
	for (const [name, source, modes, [path, offset], steps, opened, typed] of ROWS)
		for (const mode of modes)
			it(`${name}, ${mode}`, async () => {
				const editor = mountEditor<EditorTestSurface>({ source, presentationMode: mode });
				await editor.settle();
				placeCaret(surfaceAt(editor, path), offset);
				await editor.settle();
				let after = '';
				for (const step of steps) after = await press(editor, step);
				expect([after, await press(editor, 'x')]).toEqual([opened, typed]);
			});
});

// The same gestures where no blank block takes the trailing line: nothing there moves.
describe('a last block that keeps its trailing line', () => {
	const ROWS: [string, string, PresentationMode[], [number[], number, number], string, string][] = [
		['two trailing blank lines', 'ab\n\n\n', MODES, [[0], 0, 2], '\n\n', 'x\n\n\n'],
		['a source heading', '# ab\n\n', ['source'], [[0], 2, 4], '# \n\n', '# x\n\n'],
		['an item', '- ab\n\n', MODES, [[0, 0, 0], 0, 2], '- \n\n', '- x\n\n'],
		['a quote', '> ab\n\n', MODES, [[0, 0], 0, 2], '>\n\n', '> x\n\n'],
		['a closed last line', 'ab\n', MODES, [[0], 0, 2], '\n', 'x\n'],
		['a closed live heading', '# ab\n', ['live'], [[0], 2, 4], '\n', 'x\n'],
		['an open last line', 'ab', MODES, [[0], 0, 2], '', 'x'],
		// The item's own blank line is all that parts the list from the table under it.
		[
			'a task item over a table',
			'- [x] ab\n \t \n| H |\n| - |\n',
			MODES,
			[[0, 0, 0], 0, 2],
			'- [x] \n \t \n| H |\n| - |\n',
			'- [x] x\n\n \t \n| H |\n| - |\n'
		]
	];
	for (const [name, source, modes, selection, emptied, typed] of ROWS)
		for (const mode of modes)
			it(`${name}, ${mode}, Delete`, async () => {
				expect(await emptyThenType(source, mode, selection, 'Delete')).toEqual([emptied, typed]);
			});
});

// @vitest-environment jsdom
// A callout's title emptied by any gesture that takes its whole text, from either holder of a
// selection, leaves the opening row standing with its name, and the next letter is a new title.
// Miss-analysis: the whole-text rows emptied headings and runs, whose markers may go with their
// text, and no row emptied a title row, whose `:::name` opens the container it heads.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { deleteBy, dispatchBeforeInput, insertBy } from '#lib/test/harness/insertion-routes.js';
import {
	clipboardGesture,
	mountCase,
	placeOwnedRange,
	placeRange,
	typeGesture,
	type Editor
} from '#lib/test/range-laws/gestures.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['live', 'source'];
const TIP = ':::tip Title\nin\n:::\n';
const focused = () => document.activeElement as HTMLElement;

async function settled(editor: Editor, act: () => Promise<unknown>): Promise<string> {
	await act();
	await editor.settle();
	return editor.source();
}

const letter = (editor: Editor) => settled(editor, () => insertBy('hardware key', focused(), 'x'));

/** A soft keyboard's delete: `beforeinput` with no keydown, then the browser's own removal where
 *  the editor leaves it, which jsdom doesn't perform. */
async function softDelete(el: HTMLElement): Promise<void> {
	if (dispatchBeforeInput(el, 'deleteContentBackward').defaultPrevented) return;
	window.getSelection()!.getRangeAt(0).deleteContents();
	el.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
}

const TITLE = { anchor: { path: [0, 0], offset: 7 }, focus: { path: [0, 0], offset: 12 } };
const HOLDERS = [
	['the browser’s range', placeRange],
	['a finger’s range', placeOwnedRange]
] as const;

/** Each gesture that takes the selected title's whole text, and the title it leaves. */
const GESTURES: [string, (editor: Editor) => Promise<unknown>, string][] = [
	['Backspace', () => deleteBy(focused(), 'Backspace'), ''],
	['Delete', () => deleteBy(focused(), 'Delete'), ''],
	['a soft keyboard’s delete', () => softDelete(focused()), ''],
	[
		'a cut',
		async (editor) =>
			expect((await clipboardGesture(editor, 'cut', 'key'))['text/plain']).toBe('Title'),
		''
	],
	['a typed space', (editor) => typeGesture(editor, { text: ' ', route: 'hardware key' }), ' '],
	[
		'a composition cancelled',
		(editor) => typeGesture(editor, { text: '', route: 'composition' }),
		''
	]
];

describe('a selected title emptied keeps its row', () => {
	for (const mode of MODES)
		for (const [holder, place] of HOLDERS)
			for (const [name, gesture, left] of GESTURES)
				it(`${name}, ${holder}, ${mode}`, async () => {
					const editor = mountCase(TIP, mode);
					await editor.settle();
					expect(await place(editor, TITLE)).toBe(true);
					expect(await settled(editor, () => gesture(editor))).toBe(`:::tip ${left}\nin\n:::\n`);
					expect(await letter(editor)).toBe(`:::tip ${left}x\nin\n:::\n`);
				});
});

describe('a title erased at a caret keeps its row', () => {
	const ROWS: [string, string, number[], number, () => Promise<unknown>, string][] = [
		[
			'Backspace over its last letter',
			':::tip T\nin\n:::\n',
			[0, 0],
			8,
			() => deleteBy(focused(), 'Backspace'),
			':::tip x\nin\n:::\n'
		],
		[
			'a word delete from its end',
			TIP,
			[0, 0],
			12,
			async () => dispatchBeforeInput(focused(), 'deleteWordBackward'),
			':::tip x\nin\n:::\n'
		],
		[
			'Backspace in a nested tip',
			'::::note\n:::tip T\nin\n:::\n::::\n',
			[0, 1, 0],
			8,
			() => deleteBy(focused(), 'Backspace'),
			'::::note\n:::tip x\nin\n:::\n::::\n'
		],
		// Controls: a summary has no marker, and a heading's markers go with its text in live mode.
		[
			'Backspace over a summary’s last letter',
			'<details open>\n<summary>T</summary>\n\nbody\n\n</details>\n',
			[0, 0],
			1,
			() => deleteBy(focused(), 'Backspace'),
			'<details open>\n<summary>x</summary>\n\nbody\n\n</details>\n'
		],
		[
			'Backspace over a heading’s last letter',
			'# T\n\nnext\n',
			[0],
			3,
			() => deleteBy(focused(), 'Backspace'),
			'x\n\nnext\n'
		]
	];
	for (const [name, source, path, offset, gesture, typed] of ROWS)
		it(`${name}, live`, async () => {
			const editor = mountCase(source, 'live');
			await editor.settle();
			placeCaret(surfaceAt(editor, path), offset);
			await editor.settle();
			await settled(editor, gesture);
			expect(await letter(editor)).toBe(typed);
		});
});

describe('a letter typed over the title replaces it', () => {
	for (const mode of MODES)
		for (const [holder, place] of HOLDERS)
			it(`${holder}, ${mode}`, async () => {
				const editor = mountCase(TIP, mode);
				await editor.settle();
				await place(editor, TITLE);
				expect(await letter(editor)).toBe(':::tip x\nin\n:::\n');
			});
});

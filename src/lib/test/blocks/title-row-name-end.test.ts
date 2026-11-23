// @vitest-environment jsdom
// Text typed at the end of an untitled `:::` row whose name the editor holds starts the title when
// it would lengthen the name (`docs/design/live-mode.md` § 4.1); anything else goes in as typed.
// Miss-analysis: the name-end rows typed only a letter after a placed caret and pinned the renamed
// container, so no row asked what a letter there should start, nor met a digit, a dash or an IME.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { deleteBy, insertBy } from '#lib/test/harness/insertion-routes.js';
import { microtaskCheckpoint } from '#lib/test/harness/microtask-settle.js';
import { mountCase, type Editor } from '#lib/test/range-laws/gestures.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
});

const MODES: PresentationMode[] = ['live', 'source'];
const focused = () => document.activeElement as HTMLElement;

async function mountAt(source: string, mode: PresentationMode, at: number): Promise<Editor> {
	const editor = mountCase(source, mode);
	await editor.settle();
	placeCaret(surfaceAt(editor, [0, 0]), at);
	await editor.settle();
	return editor;
}

// A caret stepped into the name from the title's start (the row's end when untitled), as ArrowLeft
// takes it: in live mode one put there with no caret on the row before it moves to the title's start.
async function mountInName(
	source: string,
	mode: PresentationMode,
	steps: number[]
): Promise<Editor> {
	const editor = mountCase(source, mode);
	await editor.settle();
	const row = surfaceAt(editor, [0, 0]);
	for (const step of steps) {
		placeCaret(row, step);
		// jsdom fires no `selectionchange` of its own.
		document.dispatchEvent(new Event('selectionchange'));
		await editor.settle();
	}
	return editor;
}

async function typed(editor: Editor, text: string): Promise<string> {
	await insertBy('hardware key', focused(), text);
	await editor.settle();
	return editor.source();
}

/** [what is typed, at the end of `:::tip`, the row it writes] */
const TYPED: [string, string, string][] = [
	['a letter', 'x', ':::tip x'],
	['a capital', 'X', ':::tip X'],
	['a digit', '7', ':::tip 7'],
	['a dash', '-', ':::tip -'],
	['two letters', 'xy', ':::tip xy'],
	['a character no name holds', '!', ':::tip!'],
	['a space', ' ', ':::tip '],
	['an accented letter', 'é', ':::tipé'],
	['an opening brace', '{', ':::tip{']
];

describe('text typed at an untitled row’s name end', () => {
	for (const mode of MODES) {
		for (const [name, text, row] of TYPED)
			it(`${mode}: ${name}`, async () => {
				const editor = await mountAt(':::tip\nin\n:::\n', mode, 6);
				expect(await typed(editor, text)).toBe(`${row}\nin\n:::\n`);
			});

		it(`${mode}: the caret follows the letter, and the next one joins the title`, async () => {
			const editor = await mountAt(':::tip\nin\n:::\n', mode, 6);
			expect(await typed(editor, 'xy')).toBe(':::tip xy\nin\n:::\n');
			expect(editor.instance.getSelection()?.focus).toEqual({ path: [0, 0], offset: 9 });
		});

		it(`${mode}: the gap and the letter are one undo entry`, async () => {
			const editor = await mountAt(':::tip\nin\n:::\n', mode, 6);
			const depth = editor.instance.__test.getUndoStack().undo.length;
			await typed(editor, 'x');
			expect(editor.instance.__test.getUndoStack().undo.length).toBe(depth + 1);
		});

		// Ruling 21's six Backspaces leave the bare name, and a letter then starts a new title.
		it(`${mode}: six Backspaces from a title, then a letter`, async () => {
			const editor = await mountAt(':::tip Title\nin\n:::\n', mode, 12);
			for (let i = 0; i < 6; i++) await deleteBy(focused(), 'Backspace');
			await editor.settle();
			expect(editor.source()).toBe(':::tip\nin\n:::\n');
			expect(await typed(editor, 'x')).toBe(':::tip x\nin\n:::\n');
		});

		it(`${mode}: a name the editor does not hold grows`, async () => {
			const editor = await mountAt(':::foo\nin\n:::\n', mode, 6);
			expect(await typed(editor, 'x')).toBe(':::foox\nin\n:::\n');
		});

		it(`${mode}: a letter at a titled row’s name end edits the name`, async () => {
			const editor = await mountInName(':::tip Title\nin\n:::\n', mode, [7, 6]);
			expect(await typed(editor, 'x')).toBe(':::tipx Title\nin\n:::\n');
		});

		it(`${mode}: a letter inside the name edits the name`, async () => {
			const editor = await mountInName(':::tip\nin\n:::\n', mode, [6, 5]);
			expect(await typed(editor, 'x')).toBe(':::tixp\nin\n:::\n');
		});
	}

	// The browser writes nothing the editor reads while a composition runs, so the gap waits for the
	// commit rather than landing inside the text the IME is still composing.
	it('a composition of Latin letters gets its gap at the commit, never before', async () => {
		const editor = await mountAt(':::tip\nin\n:::\n', 'live', 6);
		const el = focused();
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		await microtaskCheckpoint();
		const range = window.getSelection()!.getRangeAt(0);
		range.insertNode(document.createTextNode('xy'));
		range.collapse(false);
		el.dispatchEvent(
			new InputEvent('input', {
				inputType: 'insertCompositionText',
				data: 'xy',
				isComposing: true,
				bubbles: true
			})
		);
		await editor.settle();
		expect(editor.source()).toBe(':::tip\nin\n:::\n');

		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'xy' }));
		await editor.settle();
		expect(editor.source()).toBe(':::tip xy\nin\n:::\n');
	});

	it('a composition of a character no name holds goes in as typed', async () => {
		const editor = await mountAt(':::tip\nin\n:::\n', 'live', 6);
		await insertBy('composition', focused(), 'か');
		await editor.settle();
		expect(editor.source()).toBe(':::tipか\nin\n:::\n');
	});
});

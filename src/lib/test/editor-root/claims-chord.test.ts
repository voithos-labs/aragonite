// @vitest-environment jsdom
// Miss-analysis: GH #805; `claimsChord` read the union of every kind's keymap, and every row asked
// it about a chord with no caret anywhere, so a table chord claimed in a paragraph passed.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import type { KeybindingOverride } from '#lib/schema/keybinding-overrides.js';
import { cellAt } from '../blocks/table/mount-table';

beforeAll(installLayoutStubs);
afterEach(async () => {
	vi.unstubAllGlobals();
	await destroyMountedEditors();
});

const DOC = 'para text here\n\n| A | B |\n| --- | --- |\n| 1 | middle |\n';

const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
const ALT_LEFT = { key: 'ArrowLeft', altKey: true };

function mount(keybindings?: KeybindingOverride[]): MountedEditor {
	return mountEditor({ source: DOC, presentationMode: 'source', keybindings });
}

function caretInParagraph(editor: MountedEditor): void {
	placeCaret(surfaceAt(editor, [0]), 5);
}

function caretInCell(editor: MountedEditor): void {
	placeCaret(cellAt(editor, 1, 1, [1]), 3);
}

describe('claimsChord answers for where the caret is', () => {
	it('leaves the table’s Alt+← to the host with the caret in a paragraph', async () => {
		const editor = mount();
		await editor.settle();
		caretInParagraph(editor);
		expect(editor.instance.claimsChord(press(ALT_LEFT))).toBe(false);
	});

	it('takes Alt+← in a table cell, where it moves the column', async () => {
		const editor = mount();
		await editor.settle();
		caretInCell(editor);
		expect(editor.instance.claimsChord(press(ALT_LEFT))).toBe(true);
	});

	it('takes the caret keys in a paragraph', async () => {
		const editor = mount();
		await editor.settle();
		caretInParagraph(editor);
		for (const init of [
			{ key: 'ArrowRight', ctrlKey: true },
			{ key: 'ArrowLeft', ctrlKey: true, shiftKey: true },
			{ key: 'Home' },
			{ key: 'End', shiftKey: true }
		]) {
			expect(editor.instance.claimsChord(press(init)), JSON.stringify(init)).toBe(true);
		}
	});

	it('takes an override scoped to tableCell in a cell only', async () => {
		const chord = { key: 'J', ctrlKey: true, shiftKey: true };
		const editor = mount([
			{ kind: 'tableCell', chord: 'Mod+Shift+J', command: 'table.insertRowBelow' }
		]);
		await editor.settle();
		caretInParagraph(editor);
		expect(editor.instance.claimsChord(press(chord))).toBe(false);
		caretInCell(editor);
		expect(editor.instance.claimsChord(press(chord))).toBe(true);
	});

	it('answers false with focus outside the editor, and for the editor without focus', async () => {
		const editor = mount();
		const other = mount();
		await editor.settle();
		caretInParagraph(editor);
		expect(other.instance.claimsChord(press({ key: 'b', ctrlKey: true }))).toBe(false);
		const field = document.body.appendChild(document.createElement('input'));
		field.focus();
		expect(editor.instance.claimsChord(press({ key: 'b', ctrlKey: true }))).toBe(false);
		field.remove();
	});

	it('takes a key that belongs to a composition', async () => {
		const editor = mount();
		await editor.settle();
		caretInParagraph(editor);
		expect(editor.instance.claimsChord(press({ key: 'Process' }))).toBe(true);
	});

	it('reads Ctrl and Cmd alike, and a CapsLock letter as its binding', async () => {
		const editor = mount();
		await editor.settle();
		caretInParagraph(editor);
		for (const init of [
			{ key: 'b', ctrlKey: true },
			{ key: 'b', metaKey: true },
			{ key: 'B', ctrlKey: true }
		]) {
			expect(editor.instance.claimsChord(press(init)), JSON.stringify(init)).toBe(true);
		}
		expect(editor.instance.claimsChord(press({ key: 'q', ctrlKey: true }))).toBe(false);
		expect(editor.instance.claimsChord(press({ key: 'Control', ctrlKey: true }))).toBe(false);
	});
});

// Option+Arrow is a Mac's word key, so the table yields it to the caret there.
describe('claimsChord on a Mac', () => {
	it('takes Option+← as the word key in a paragraph and in a cell', async () => {
		vi.stubGlobal('navigator', { platform: 'MacIntel' });
		const editor = mount();
		await editor.settle();
		caretInParagraph(editor);
		expect(editor.instance.claimsChord(press(ALT_LEFT))).toBe(true);
		caretInCell(editor);
		expect(editor.instance.claimsChord(press(ALT_LEFT))).toBe(true);
	});
});

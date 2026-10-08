// @vitest-environment jsdom
// A command run in the middle of a typing burst is its own undo entry.
// Miss-analysis: GH #525, the undo suite ran only the toggle's wrapper, no other command.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { UndoEntry } from '#lib/undo/types.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt,
	typeInFirstBlock,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { cellAt, installTableLayoutStubs } from './table/mount-table';

beforeAll(() => {
	installLayoutStubs();
	return installTableLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

function undoStack(editor: MountedEditor): UndoEntry[] {
	return (
		editor.instance as unknown as { __test: { getUndoStack(): { undo: UndoEntry[] } } }
	).__test.getUndoStack().undo;
}

interface CommandCaller {
	name: string;
	source: string;
	mode: PresentationMode;
	surface(editor: MountedEditor): HTMLElement;
	/** The editable element's whole text once the burst is typed; the caret ends after it. */
	typed: string;
	command(editor: MountedEditor, el: HTMLElement): Promise<unknown>;
	afterTyping: string;
	afterCommand: string;
}

// One row per block that writes a command's bytes through `isolateUndoEntry`.
const CALLERS: CommandCaller[] = [
	{
		name: 'a heading chord in a paragraph',
		source: 'ab\n',
		mode: 'source',
		surface: (editor) => surfaceAt(editor, [0]),
		typed: 'abc',
		command: (_editor, el) => pressKey(el, { key: '1', ctrlKey: true }),
		afterTyping: 'abc\n',
		afterCommand: '# abc\n'
	},
	{
		name: 'a bold chord in a table cell',
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
		mode: 'source',
		surface: (editor) => cellAt(editor, 1, 0),
		typed: '12',
		command: (_editor, el) => {
			selectRange(el, 0, 2);
			return pressKey(el, { key: 'b', ctrlKey: true });
		},
		afterTyping: '| A | B |\n| --- | --- |\n| 12 | 2 |\n',
		afterCommand: '| A | B |\n| --- | --- |\n| **12** | 2 |\n'
	},
	{
		name: 'the code block’s language chip',
		source: '```js\nconst x = 1\n```\n',
		mode: 'live',
		surface: (editor) => surfaceAt(editor, [0]),
		typed: '```js\nconst x = 12\n```',
		command: (editor) => {
			editor.target.querySelector<HTMLButtonElement>('.code-lang-button')!.click();
			flushSync();
			const field = document.querySelector<HTMLInputElement>('.code-lang-picker input')!;
			field.value = 'ts';
			field.dispatchEvent(new Event('input', { bubbles: true }));
			return pressKey(field, { key: 'Enter' });
		},
		afterTyping: '```js\nconst x = 12\n```\n',
		afterCommand: '```ts\nconst x = 12\n```\n'
	}
];

// Miss-analysis: each block that runs a command got its undo row on its own, and the table cell
// never got one.
describe('one Mod+Z after typing then a command takes back the command alone', () => {
	for (const caller of CALLERS) {
		it(caller.name, async () => {
			const editor = mountEditor({ source: caller.source, presentationMode: caller.mode });
			typeInto(caller.surface(editor), caller.typed);
			await editor.settle();
			expect(editor.source()).toBe(caller.afterTyping);

			await caller.command(editor, caller.surface(editor));
			await editor.settle();
			expect(editor.source()).toBe(caller.afterCommand);

			await pressKey(caller.surface(editor), { key: 'z', ctrlKey: true });
			await editor.settle();
			expect(editor.source()).toBe(caller.afterTyping);
		});
	}
});

// Shift+Enter mid-text: at the end it writes nothing until the next insertion (below).
for (const [id, arg, at] of [
	['heading.cycle', 1, 3],
	['block.hardBreak', undefined, 1]
] as const) {
	it(`${id} after typing undoes alone`, async () => {
		const editor = mountEditor({ source: 'ab\n' });
		typeInFirstBlock(editor.target, 'abc');
		await editor.settle();
		placeCaret(surfaceAt(editor, [0]), at);

		expect(editor.instance.runCommand(id, arg)).toBe(true);
		await editor.settle();

		expect(undoStack(editor)).toHaveLength(2);
	});
}

// Counting entries alone passes with the entry pushed in the wrong place, so read the bytes back.
it('Ctrl+Z after block.hardBreak undoes the command and leaves the typing', async () => {
	const editor = mountEditor({ source: 'ab\n' });
	typeInFirstBlock(editor.target, 'abc');
	await editor.settle();
	placeCaret(surfaceAt(editor, [0]), 1);
	editor.instance.runCommand('block.hardBreak');
	await editor.settle();
	expect(editor.source()).toBe('a\\\nbc\n');

	await pressKey(surfaceAt(editor, [0]), { key: 'z', ctrlKey: true });
	await editor.settle();

	expect(editor.source()).toBe('abc\n');
});

// The break at the end is written by the insertion after it, so the two are one entry.
it('block.hardBreak at the end makes no entry, and one Ctrl+Z takes back the break and the key', async () => {
	const editor = mountEditor({ source: 'ab\n' });
	typeInFirstBlock(editor.target, 'abc');
	await editor.settle();
	const el = surfaceAt(editor, [0]);
	placeCaret(el, 3);

	await pressKey(el, { key: 'Enter', shiftKey: true });
	expect(undoStack(editor)).toHaveLength(1);
	await pressKey(el, { key: 'x' });
	expect(editor.source()).toBe('abc\\\nx\n');
	expect(undoStack(editor)).toHaveLength(2);

	await pressKey(el, { key: 'z', ctrlKey: true });
	await editor.settle();

	expect(editor.source()).toBe('abc\n');
});

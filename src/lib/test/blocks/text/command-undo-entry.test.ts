// @vitest-environment jsdom
// A command run in the middle of a typing burst is its own undo entry.
// Miss-analysis: GH #525, the undo suite ran only the toggle's wrapper, no other command.
import { it, expect, beforeAll, afterEach } from 'vitest';
import type { UndoEntry } from '$lib/undo/types';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInFirstBlock,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

function undoStack(editor: MountedEditor): UndoEntry[] {
	return (
		editor.instance as unknown as { __test: { getUndoStack(): { undo: UndoEntry[] } } }
	).__test.getUndoStack().undo;
}

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
for (const [id, arg, at, after] of [
	['heading.cycle', 1, 3, '# abc\n'],
	['block.hardBreak', undefined, 1, 'a\\\nbc\n']
] as const) {
	it(`Ctrl+Z after ${id} undoes the command and leaves the typing`, async () => {
		const editor = mountEditor({ source: 'ab\n' });
		typeInFirstBlock(editor.target, 'abc');
		await editor.settle();
		placeCaret(surfaceAt(editor, [0]), at);
		editor.instance.runCommand(id, arg);
		await editor.settle();
		expect(editor.source()).toBe(after);

		await pressKey(surfaceAt(editor, [0]), { key: 'z', ctrlKey: true });
		await editor.settle();

		expect(editor.source()).toBe('abc\n');
	});
}

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

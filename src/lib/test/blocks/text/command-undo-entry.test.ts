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

for (const [id, arg] of [
	['heading.cycle', 1],
	['block.hardBreak', undefined]
] as const) {
	it(`${id} after typing undoes alone`, async () => {
		const editor = mountEditor({ source: 'ab\n' });
		typeInFirstBlock(editor.target, 'abc');
		await editor.settle();
		placeCaret(surfaceAt(editor, [0]), 3);

		expect(editor.instance.runCommand(id, arg)).toBe(true);
		await editor.settle();

		expect(undoStack(editor)).toHaveLength(2);
	});
}

// Counting entries alone passes with the entry pushed in the wrong place, so read the bytes back.
for (const [id, arg, after] of [
	['heading.cycle', 1, '# abc\n'],
	['block.hardBreak', undefined, 'abc\\\n']
] as const) {
	it(`Ctrl+Z after ${id} undoes the command and leaves the typing`, async () => {
		const editor = mountEditor({ source: 'ab\n' });
		typeInFirstBlock(editor.target, 'abc');
		await editor.settle();
		placeCaret(surfaceAt(editor, [0]), 3);
		editor.instance.runCommand(id, arg);
		await editor.settle();
		expect(editor.source()).toBe(after);

		await pressKey(surfaceAt(editor, [0]), { key: 'z', ctrlKey: true });
		await editor.settle();

		expect(editor.source()).toBe('abc\n');
	});
}

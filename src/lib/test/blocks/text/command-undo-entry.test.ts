// @vitest-environment jsdom
//
// A command is not typing: run mid-burst it is its own undo entry (#525).
// Miss-analysis: the isolation suite drove the controller with the toggle's own wrapper, so the
// commands whose branch never took the wrapper had no case.
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

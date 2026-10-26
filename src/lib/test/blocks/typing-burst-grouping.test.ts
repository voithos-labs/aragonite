// @vitest-environment jsdom
// Which writes join the typing burst around them: the keys that type text do, Tab and a key typed
// over a selection included, so one Ctrl+Z takes back the burst with them.
// Miss-analysis: the burst suites typed plain characters only; Tab ran inside a command's isolation.
import { it, expect, beforeAll, afterEach, vi } from 'vitest';
import { UNDO_DEBOUNCE_MS } from '#lib/editor-actions/commit/text-batch.js';
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

it('Tab between two typed keys joins their burst', async () => {
	const editor = mountEditor({ source: 'ab\n' });
	typeInFirstBlock(editor.target, 'abc');
	await editor.settle();
	placeCaret(surfaceAt(editor, [0]), 3);

	expect(editor.instance.runCommand('block.insertTab')).toBe(true);
	await editor.settle();
	typeInto(surfaceAt(editor, [0]), 'abc\td');
	await editor.settle();

	expect(editor.source()).toBe('abc\td\n');
	expect(undoStack(editor)).toHaveLength(1);
});

it('a key typed over a selection right after typing joins the burst', async () => {
	const editor = mountEditor({ source: 'ab\n' });
	typeInFirstBlock(editor.target, 'abc');
	await editor.settle();
	selectRange(surfaceAt(editor, [0]), 2, 3);

	typeInto(surfaceAt(editor, [0]), 'abx');
	await editor.settle();

	expect(editor.source()).toBe('abx\n');
	expect(undoStack(editor)).toHaveLength(1);
});

// Miss-analysis: the pause was tested on the batch alone, so a keystroke that never armed it
// reddened only an unrelated host-prop row.
it('a pause after a key ends its burst, so the next key is an undo entry of its own', async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	try {
		const editor = mountEditor({ source: 'ab\n' });
		typeInFirstBlock(editor.target, 'abc');
		await editor.settle();
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS);

		typeInto(surfaceAt(editor, [0]), 'abcd');
		await editor.settle();

		expect(editor.source()).toBe('abcd\n');
		expect(undoStack(editor)).toHaveLength(2);
	} finally {
		vi.useRealTimers();
	}
});

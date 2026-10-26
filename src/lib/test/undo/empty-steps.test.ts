// @vitest-environment jsdom
// Miss-analysis: every undo suite checked gestures that changed the bytes, and `canRunCommand`
// was only ever asked of block commands, so a gesture that wrote its bytes back read as a step.
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
import { endTypingBatchesForTests } from '#lib/editor-actions/commit/text-batch.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const SOURCE = 'ab\n\ncd\n';
const STEPPED = 'ab\n\ncdx\n';

async function press(editor: MountedEditor, path: number[], offset: number, key: string) {
	const el = surfaceAt(editor, path);
	placeCaret(el, offset);
	await pressHardwareKey(el, { key });
	await editor.settle();
}

async function run(editor: MountedEditor, command: string): Promise<string> {
	editor.instance.runCommand(command);
	await editor.settle();
	return editor.source();
}

/** Each gesture writes into `ab`, the first block, and leaves the document's bytes as they were. */
const NET_EMPTY: [string, (editor: MountedEditor) => Promise<void>][] = [
	[
		'a typing run that deletes what it typed',
		async (editor) => {
			await press(editor, [0], 2, 'z');
			await press(editor, [0], 3, 'Backspace');
		}
	],
	[
		'a paste of the selected text over itself',
		async (editor) => {
			const el = surfaceAt(editor, [0]);
			selectRange(el, 0, 2);
			dispatchPaste(el, 'ab');
			await editor.settle();
		}
	],
	[
		"a host's insert of the selected text over itself",
		async (editor) => {
			selectRange(surfaceAt(editor, [0]), 0, 2);
			await editor.instance.insertMarkdown('ab');
			await editor.settle();
		}
	]
];

describe('a gesture whose net change is nothing is no undo step', () => {
	it.each(NET_EMPTY)('%s: one undo takes back the step before it', async (_name, gesture) => {
		const editor = mountEditor({ source: SOURCE, presentationMode: 'source' });
		await editor.settle();
		await press(editor, [1], 2, 'x');
		endTypingBatchesForTests();
		await gesture(editor);
		endTypingBatchesForTests();
		expect(editor.source(), 'the gesture changed the bytes').toBe(STEPPED);

		expect(await run(editor, 'history.undo')).toBe(SOURCE);
		expect(editor.instance.canRunCommand('history.undo')).toBe(false);
	});
});

describe('canRunCommand for undo and redo', () => {
	it('is false with nothing to undo or redo, and true while there is', async () => {
		const editor = mountEditor({ source: SOURCE, presentationMode: 'source' });
		await editor.settle();
		const can = () => ({
			undo: editor.instance.canRunCommand('history.undo'),
			redo: editor.instance.canRunCommand('history.redo')
		});
		expect(can(), 'a fresh document').toEqual({ undo: false, redo: false });
		await press(editor, [1], 2, 'x');
		endTypingBatchesForTests();
		expect(can(), 'after a keystroke').toEqual({ undo: true, redo: false });
		await run(editor, 'history.undo');
		expect(can(), 'after undoing it').toEqual({ undo: false, redo: true });
		await run(editor, 'history.redo');
		expect(can(), 'after redoing it').toEqual({ undo: true, redo: false });
	});
});

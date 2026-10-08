// @vitest-environment jsdom
// Tab and Shift+Tab in a code block, then Ctrl+Z: the caret goes back to where the key was pressed.
// Miss-analysis: the indent's undo rows ran the command over a selection, never the key at a
// caret, and none read the caret the undo put back.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createSurfaceBackend } from '#lib/caret/surface-backend.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { newestEntryCaret } from '../../support/undo-entry';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

beforeAll(() => {
	installLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const PLAIN = '```\nabc\ndef\n```\n';
const INDENTED = '```\n\tabc\n\tdef\n```\n';

describe.each([
	['Tab', false, PLAIN, '```\nab\tc\ndef\n```\n', '```\n\tabc\n\tdef\n```\n'],
	['Shift+Tab', true, INDENTED, '```\nabc\n\tdef\n```\n', PLAIN]
])('%s then Ctrl+Z', (_key, shiftKey, source, atCaret, overLines) => {
	it.each([
		['at a caret', 6, 6, atCaret],
		['over a selection', 5, 12, overLines]
	])('%s puts the caret back where the key was pressed', async (_at, start, end, after) => {
		const editor = mountEditor({ source, presentationMode: 'source' });
		const el = surfaceAt(editor, [0]);
		if (start === end) placeCaret(el, start);
		else selectRange(el, start, end);

		await pressKey(el, { key: 'Tab', shiftKey });
		await editor.settle();
		expect(editor.source()).toBe(after);
		expect(newestEntryCaret(editor)).toEqual({ path: [0], offset: start });

		await pressKey(el, { key: 'z', ctrlKey: true });
		await editor.settle();
		expect(editor.source()).toBe(source);
		expect(
			createSurfaceBackend({
				caretWriter: testCaretWriter,
				getEl: () => surfaceAt(editor, [0])
			}).getRaw()
		).toBe(start);
	});
});

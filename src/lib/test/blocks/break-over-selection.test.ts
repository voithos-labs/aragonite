// @vitest-environment jsdom
// A key that breaks the line over a selection inside one block replaces the selection, as typing
// over it would: Enter and Shift+Enter in prose, the code block's Enter, a cell's line break.
// Miss-analysis: every split and hard-break test pressed the key at a collapsed caret, so nothing
// saw the prose commands split at the caret and leave the selected text in place.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey, settleEditor } from '$lib/test/harness/settle';
import { cellAt } from '$lib/test/blocks/table/mount-table';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES = ['source', 'live'] as const;

const ROUTES = [
	['a paragraph, Enter', 'alpha\n', 1, 3, {}, 'a\n\nha\n'],
	['a paragraph, Shift+Enter', 'alpha\n', 1, 3, { shiftKey: true }, 'a\\\nha\n'],
	['a heading, Enter', '# alpha\n', 3, 5, {}, '# a\nha\n'],
	['a heading, Shift+Enter', '# alpha\n', 3, 5, { shiftKey: true }, '# a\\\nha\n'],
	['a code block, Enter', '```\nalpha\n```\n', 5, 7, {}, '```\na\nha\n```\n']
] as const;

describe.each(MODES)('%s mode: a break key over a selection in one block', (mode) => {
	it.each(ROUTES)('%s writes the break where the selection was', async (...row) => {
		const [, source, start, end, modifiers, written] = row;
		const editor = mountEditor({ source, presentationMode: mode });
		const el = surfaceAt(editor, [0]);
		selectRange(el, start, end);

		await pressKey(el, { key: 'Enter', ...modifiers });
		await settleEditor();

		expect(editor.source()).toBe(written);
	});

	it('Shift+Enter over a selection running to the end opens the line and writes nothing', async () => {
		const editor = mountEditor({ source: 'alpha\n', presentationMode: mode });
		const el = surfaceAt(editor, [0]);
		selectRange(el, 3, 5);

		await pressKey(el, { key: 'Enter', shiftKey: true });
		await settleEditor();

		expect(editor.source()).toBe('alp\n');
	});

	it('one undo puts the selected text back', async () => {
		const editor = mountEditor({ source: 'alpha\n', presentationMode: mode });
		const el = surfaceAt(editor, [0]);
		selectRange(el, 1, 3);
		await pressKey(el, { key: 'Enter' });
		await settleEditor();

		await pressKey(surfaceAt(editor, [0]), { key: 'z', ctrlKey: true });
		await settleEditor();

		expect(editor.source()).toBe('alpha\n');
	});

	it('a table cell’s line break writes its `<br>` where the selection was', async () => {
		const editor = mountEditor({ source: '| a |\n| - |\n| alpha |\n', presentationMode: mode });
		const el = cellAt(editor, 1, 0);
		selectRange(el, 1, 3);

		el.dispatchEvent(
			new InputEvent('beforeinput', {
				inputType: 'insertLineBreak',
				bubbles: true,
				cancelable: true
			})
		);
		await settleEditor();

		expect(editor.source()).toBe('| a |\n| - |\n| a<br>ha |\n');
	});

	// Enter in a cell moves to the cell below rather than breaking the line, so the text stays.
	it('Enter in a table cell moves down and leaves the selected text', async () => {
		const editor = mountEditor({ source: '| a |\n| - |\n| alpha |\n', presentationMode: mode });
		const el = cellAt(editor, 1, 0);
		selectRange(el, 1, 3);

		await pressKey(el, { key: 'Enter' });
		await settleEditor();

		expect(editor.source()).toBe('| a |\n| - |\n| alpha |\n|  |\n');
	});
});

describe('EditorInstance.runCommand over a selection in one block', () => {
	it.each([
		['block.split', 'a\n\nha\n'],
		['block.hardBreak', 'a\\\nha\n']
	])('%s writes the break where the selection was', async (id, written) => {
		const editor = mountEditor({ source: 'alpha\n' });
		selectRange(surfaceAt(editor, [0]), 1, 3);

		editor.instance.runCommand(id);
		await settleEditor();

		expect(editor.source()).toBe(written);
	});
});

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
import {
	AFTER_RANGE_REMOVAL_COMMAND_IDS,
	AFTER_SELECTION_REMOVAL_COMMAND_IDS
} from '$lib/schema/commands';

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

	// A line break the browser sends as input, which no command carries.
	it.each([
		['a table cell', '| a |\n| - |\n| alpha |\n', 1, '| a |\n| - |\n| a<br>ha |\n'],
		['a code block', '```\nalpha\n```\n', 5, '```\na\nha\n```\n']
	])('%s: a line break typed as input lands where the selection was', async (...row) => {
		const [where, source, start, written] = row;
		const editor = mountEditor({ source, presentationMode: mode });
		const el = where === 'a table cell' ? cellAt(editor, 1, 0) : surfaceAt(editor, [0]);
		selectRange(el, start, start + 2);

		el.dispatchEvent(
			new InputEvent('beforeinput', {
				inputType: 'insertLineBreak',
				bubbles: true,
				cancelable: true
			})
		);
		await settleEditor();

		expect(editor.source()).toBe(written);
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

describe('live mode: a code block', () => {
	// Live mode hides the fence lines, so only the body part of the selection goes.
	it('Enter over a selection running into a code block’s hidden closer', async () => {
		const editor = mountEditor({ source: '```js\nconst x = 1\n```\n', presentationMode: 'live' });
		const el = surfaceAt(editor, [0]);
		selectRange(el, 12, 20);

		await pressKey(el, { key: 'Enter' });
		await settleEditor();

		expect(editor.source()).toBe('```js\nconst \n\n```\n');
	});
});

describe('EditorInstance.runCommand over a selection in one block', () => {
	// The code block's row reaches its removal only through the member its instance publishes.
	it.each([
		['block.split', 'alpha\n', 1, 'a\n\nha\n'],
		['block.hardBreak', 'alpha\n', 1, 'a\\\nha\n'],
		['code.newline', '```\nalpha\n```\n', 5, '```\na\nha\n```\n']
	])('%s writes the break where the selection was', async (id, source, start, written) => {
		const editor = mountEditor({ source });
		selectRange(surfaceAt(editor, [0]), start, start + 2);

		editor.instance.runCommand(id);
		await settleEditor();

		expect(editor.source()).toBe(written);
	});
});

// Over a range spanning blocks the same commands remove first too; one missing from that set
// would write under the live range.
describe('the built-in commands that remove a selection first', () => {
	it('each runs after a range’s removal too', () => {
		for (const id of AFTER_SELECTION_REMOVAL_COMMAND_IDS) {
			expect(AFTER_RANGE_REMOVAL_COMMAND_IDS.has(id), id).toBe(true);
		}
	});
});

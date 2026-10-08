import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { nextRow } from '../presentation/helpers';

// A marker typed at a line's start turns the block into a container; the key after it must land
// where the user was typing, at the start of the text the container now holds.

const ON_A_PLAIN_LINE = [
	{ shape: 'a bullet', typed: '- ', expected: '- Qabcdef\n' },
	{ shape: 'a quote', typed: '> ', expected: '> Qabcdef\n' },
	{ shape: 'an ordered item', typed: '1. ', expected: '1. Qabcdef\n' },
	{ shape: 'a task', typed: '- [ ] ', expected: '- [ ] Qabcdef\n' },
	{ shape: 'a heading', typed: '# ', expected: '# Qabcdef\n' }
];

const IN_CONTEXT = [
	{
		shape: 'a task in an existing item',
		doc: '- abcdef\n',
		path: [0, 0, 0],
		typed: '[ ] ',
		expected: '- [ ] Qabcdef\n'
	},
	{
		shape: 'a bullet under a list',
		doc: '- a\n\nabcdef\n',
		path: [1],
		typed: '- ',
		expected: '- a\n\n- Qabcdef\n'
	},
	{
		shape: 'a quote inside a list item',
		doc: '- a\n\n  abcdef\n',
		path: [0, 0, 1],
		typed: '> ',
		expected: '- a\n\n  > Qabcdef\n'
	}
];

test.describe('text editing, a marker typed at a line start', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function typeMarkerThenKey(doc: string, path: number[], typed: string): Promise<void> {
		await nextRow(editor, doc);
		await editor.focusBlockAtPath(path, 0);
		await editor.page.keyboard.type(typed);
		await editor.page.keyboard.type('Q');
	}

	test('typing a marker before `abcdef` keeps the caret before the text', async () => {
		for (const { shape, typed, expected } of ON_A_PLAIN_LINE) {
			await test.step(shape, async () => {
				await typeMarkerThenKey('abcdef\n', [0], typed);
				await expect.poll(() => editor.bridge.getSource()).toBe(expected);
			});
		}
	});

	test('typing a marker in an existing item, under a list or in an item keeps the caret before the text', async () => {
		for (const { shape, doc, path, typed, expected } of IN_CONTEXT) {
			await test.step(shape, async () => {
				await typeMarkerThenKey(doc, path, typed);
				await expect.poll(() => editor.bridge.getSource()).toBe(expected);
			});
		}
	});

	test('a pasted space completing a bullet keeps the caret before the text', async () => {
		await editor.loadContent('-abcdef\n');
		await editor.seedClipboard(' ');
		await editor.focusBlockAtPath([0], 1);
		await editor.paste();
		await editor.page.keyboard.type('Q');

		await expect.poll(() => editor.bridge.getSource()).toBe('- Qabcdef\n');
	});

	// The range covers `zz` and `yy` across the blank line, so replacing it joins `-` to `abcdef`.
	test('a space typed or pasted over a cross-block range completing a bullet keeps the caret before the text', async () => {
		for (const gesture of ['type', 'paste'] as const) {
			await test.step(gesture, async () => {
				await nextRow(editor, '-zz\n\nyyabcdef\n');
				if (gesture === 'paste') await editor.seedClipboard(' ');
				await editor.focusBlockAtPath([0], 1);
				await editor.shiftClickBlock([1], 2);
				if (gesture === 'paste') await editor.paste();
				else await editor.page.keyboard.type(' ');
				await editor.page.keyboard.type('Q');

				await expect.poll(() => editor.bridge.getSource()).toBe('- Qabcdef\n');
			});
		}
	});
});

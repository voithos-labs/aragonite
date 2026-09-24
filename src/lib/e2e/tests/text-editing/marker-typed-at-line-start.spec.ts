import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A marker typed at a line's start turns the block into a container; the key after it must land
// where the user was typing, at the start of the text the container now holds.

const TYPED = [
	{ shape: 'a bullet', doc: 'abcdef\n', path: [0], typed: '- ', expected: '- Qabcdef\n' },
	{ shape: 'a quote', doc: 'abcdef\n', path: [0], typed: '> ', expected: '> Qabcdef\n' },
	{ shape: 'an ordered item', doc: 'abcdef\n', path: [0], typed: '1. ', expected: '1. Qabcdef\n' },
	{ shape: 'a task', doc: 'abcdef\n', path: [0], typed: '- [ ] ', expected: '- [ ] Qabcdef\n' },
	{ shape: 'a heading', doc: 'abcdef\n', path: [0], typed: '# ', expected: '# Qabcdef\n' },
	{
		shape: 'a task in an existing item',
		doc: '- abcdef\n',
		path: [0, 0, 0],
		typed: '[ ] ',
		expected: '- [ ] Qabcdef\n'
	},
	{
		shape: 'a bullet joining the list above',
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

	for (const { shape, doc, path, typed, expected } of TYPED) {
		test(`typing ${shape} marker keeps the caret before the text`, async () => {
			await editor.loadContent(doc);
			await editor.focusBlockAtPath(path, 0);
			await editor.page.keyboard.type(typed);
			await editor.page.keyboard.type('Q');

			await expect.poll(() => editor.bridge.getSource()).toBe(expected);
		});
	}

	test('a pasted space completing a bullet keeps the caret before the text', async () => {
		await editor.loadContent('-abcdef\n');
		await editor.seedClipboard(' ');
		await editor.focusBlockAtPath([0], 1);
		await editor.paste();
		await editor.page.keyboard.type('Q');

		await expect.poll(() => editor.bridge.getSource()).toBe('- Qabcdef\n');
	});

	// The range covers `zz` and `yy` across the blank line, so replacing it joins `-` to `abcdef`.
	for (const gesture of ['type', 'paste'] as const) {
		test(`a space ${gesture}d over a cross-block range completing a bullet keeps the caret before the text`, async () => {
			await editor.loadContent('-zz\n\nyyabcdef\n');
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

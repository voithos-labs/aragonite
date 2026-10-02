import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/list/indent-joins-item.md`.

// Each row indents the paragraph under a list by its first line, typed or pasted, and a reload
// reads the indented paragraph as the item's own, so the editor must hold it there too.
const INDENTS = [
	{ shape: 'two typed spaces', doc: '- a\n\nzz\n', typed: '  ', after: '- a\n\n  zz\n' },
	{ shape: 'two pasted spaces', doc: '- a\n\nzz\n', pasted: '  ', after: '- a\n\n  zz\n' },
	{ shape: 'a pasted tab', doc: '- a\n\nzz\n', pasted: '\t', after: '- a\n\n\tzz\n' },
	{
		shape: 'three spaces under an ordered item',
		doc: '1. a\n\nzz\n',
		typed: '   ',
		after: '1. a\n\n   zz\n'
	},
	{
		shape: 'four spaces under a nested item',
		doc: '- a\n  - b\n\nzz\n',
		typed: '    ',
		after: '- a\n  - b\n\n    zz\n'
	},
	{
		shape: 'two spaces under the outer of two nested items',
		doc: '- a\n  - b\n\nzz\n',
		typed: '  ',
		after: '- a\n  - b\n\n  zz\n'
	}
];

test.describe('indenting a paragraph under a loose list item', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const { shape, doc, typed, pasted, after } of INDENTS) {
		test(`indenting by ${shape} joins the paragraph to the item, as a reload reads it`, async ({
			page
		}) => {
			await editor.loadContent(doc);
			if (pasted) await editor.seedClipboard(pasted);
			await editor.focusBlockAtPath([1], 0);
			if (pasted) await editor.paste();
			else await page.keyboard.type(typed ?? '');

			await expect.poll(() => editor.bridge.getSource()).toBe(after);
			expect(await editor.parseConverged()).toBe(true);
		});
	}

	test('one space too few keeps the paragraph its own', async ({ page }) => {
		await editor.loadContent('1. a\n\nzz\n');
		await editor.focusBlockAtPath([1], 0);
		await page.keyboard.type('  ');

		await expect.poll(() => editor.bridge.getSource()).toBe('1. a\n\n  zz\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	// Un-indenting: a paragraph short of the item loses a space and stays its own, and once joined
	// its indent is the item's, so Backspace at its start joins it to the item's text instead.
	test('removing a space from a paragraph short of the item keeps it its own', async ({ page }) => {
		await editor.loadContent('1. a\n\n  zz\n');
		await editor.focusBlockAtPath([1], 1);
		await page.keyboard.press('Backspace');

		await expect.poll(() => editor.bridge.getSource()).toBe('1. a\n\n zz\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('Backspace at the start of the joined paragraph reloads as the tree holds', async ({
		page
	}) => {
		await editor.loadContent('- a\n\nzz\n');
		await editor.focusBlockAtPath([1], 0);
		await page.keyboard.type('  ');
		await expect.poll(() => editor.bridge.getSource()).toBe('- a\n\n  zz\n');
		await page.keyboard.press('Backspace');

		await expect.poll(() => editor.bridge.getSource()).toBe('- azz\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('the key typed after the indent lands before the text', async ({ page }) => {
		await editor.loadContent('- a\n\nzz\n');
		await editor.focusBlockAtPath([1], 0);
		await page.keyboard.type('  Q');

		await expect.poll(() => editor.bridge.getSource()).toBe('- a\n\n  Qzz\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});

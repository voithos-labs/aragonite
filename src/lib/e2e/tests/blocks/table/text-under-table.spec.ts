import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/table/text-under-table.md`.

const T = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

const ROUTES = [
	{
		name: 'Backspace at the start of a quote',
		source: `${T}> q\n`,
		edit: async (editor: EditorPage) => {
			await editor.focusBlockAtPath([1, 0], 0);
			await editor.page.keyboard.press('Backspace');
		},
		typed: `${T}\nWq\n`
	},
	{
		name: 'Backspace at the start of a quote holding a pipe',
		source: `${T}> q | r\n`,
		edit: async (editor: EditorPage) => {
			await editor.focusBlockAtPath([1, 0], 0);
			await editor.page.keyboard.press('Backspace');
		},
		typed: `${T}\nWq | r\n`
	},
	{
		name: 'Backspace at the start of a list item',
		source: `${T}- x\n`,
		edit: async (editor: EditorPage) => {
			await editor.focusBlockAtPath([1, 0, 0], 0);
			await editor.page.keyboard.press('Backspace');
		},
		typed: `${T}\nWx\n`
	},
	{
		name: 'the shortcut turning a heading into text',
		source: `${T}# Head\n`,
		edit: async (editor: EditorPage) => {
			await editor.focusBlockAtPath([1], 6);
			await editor.page.keyboard.press('ControlOrMeta+0');
		},
		typed: `${T}\nHeadW\n`
	},
	{
		name: 'Backspace deleting a thematic break between',
		source: `${T}---\nnext\n`,
		edit: async (editor: EditorPage) => {
			await editor.focusBlockAtPath([2], 0);
			await editor.page.keyboard.press('Backspace');
			await editor.page.keyboard.press('Backspace');
		},
		typed: `${T}\nWnext\n`
	}
];

test.describe('a block turned into text right under a table', () => {
	for (const route of ROUTES) {
		test(`${route.name} keeps the text a paragraph and takes the next key`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(route.source);

			await route.edit(editor);
			await page.keyboard.type('W');

			await expect.poll(() => editor.bridge.getSource()).toBe(route.typed);
			expect([await editor.bridge.getBlockKind(0), await editor.bridge.getBlockKind(1)]).toEqual([
				'table',
				'paragraph'
			]);
			expect(await editor.parseConverged()).toBe(true);
		});

		test(`${route.name}, then undo, gives back the loaded bytes`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(route.source);

			await route.edit(editor);
			await expect.poll(() => editor.bridge.getSource()).toBe(route.typed.replace('W', ''));
			await editor.waitForUndoBatchFlush();
			await editor.undo();

			await editor.bridge.waitForSourceEquals(route.source);
		});
	}
});

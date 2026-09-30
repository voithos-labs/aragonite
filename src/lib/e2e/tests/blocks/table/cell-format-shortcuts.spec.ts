import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Cells declare `supportsInline`, so Mod+B and Mod+I must format the selection the way they do
// in prose: with no keymap binding and no command dispatch on the cell, they do nothing at all.
test.describe('table cell: inline-format shortcuts', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function selectCellWord(page: EditorPage['page'], cellIndex: number, length: number) {
		await page.locator('.table-cell').nth(cellIndex).click();
		await page.keyboard.press('Home');
		for (let i = 0; i < length; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
	}

	test('Ctrl+B bolds the selected text in a cell', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | world |\n');
		await selectCellWord(page, 2, 'hello'.length);
		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('**hello**');
		expect(await editor.bridge.getSource()).toContain('| **hello** | world |');
	});

	test('Ctrl+I italicizes the selected text in a cell', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | world |\n');
		await selectCellWord(page, 2, 'hello'.length);
		await page.keyboard.press('ControlOrMeta+i');
		await editor.bridge.waitForSourceContains('*hello*');
		expect(await editor.bridge.getSource()).toContain('| *hello* | world |');
	});

	// A cell's caret behaves like prose's: the two toggles share one pure core,
	// and the cell's own escaping runs over the result.
	test('Ctrl+B at a collapsed caret inserts the empty pair', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | world |\n');
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('End');
		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('hello****');

		expect(await editor.bridge.getSource()).toContain('| hello**** | world |');
	});

	test('Ctrl+B over already-bold cell content toggles it off', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| **hello** | world |\n');
		await selectCellWord(page, 2, '**hello**'.length);
		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('| hello | world |');
		expect(await editor.bridge.getSource()).not.toContain('**');
	});
});

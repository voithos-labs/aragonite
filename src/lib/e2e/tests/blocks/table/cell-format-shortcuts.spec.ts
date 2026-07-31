import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Cells declare supportsInline, so Mod+B / Mod+I must format the selection as in prose; they used
// to fall through to a native no-op — no keymap binding, no command dispatch on the cell surface.
test.describe('table cell: inline-format shortcuts', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function selectCellWord(page: EditorPage['page'], cellIndex: number, length: number) {
		await page.locator('[role="cell"]').nth(cellIndex).click();
		await page.keyboard.press('Home');
		for (let i = 0; i < length; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
	}

	test('Ctrl+B bolds the selected text in a cell', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | world |\n');
		await selectCellWord(page, 2, 'hello'.length);
		await page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('**hello**');
		expect(await editor.bridge.getSource()).toContain('| **hello** | world |');
	});

	test('Ctrl+I italicizes the selected text in a cell', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | world |\n');
		await selectCellWord(page, 2, 'hello'.length);
		await page.keyboard.press('Control+i');
		await editor.bridge.waitForSourceContains('*hello*');
		expect(await editor.bridge.getSource()).toContain('| *hello* | world |');
	});

	// The cell's caret contract is prose's — the two toggles share one pure core,
	// and the cell's own escape door runs over its result.
	test('Ctrl+B at a collapsed caret inserts the empty pair', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | world |\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('hello****');

		expect(await editor.bridge.getSource()).toContain('| hello**** | world |');
	});

	test('Ctrl+B over already-bold cell content toggles it off', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| **hello** | world |\n');
		await selectCellWord(page, 2, '**hello**'.length);
		await page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('| hello | world |');
		expect(await editor.bridge.getSource()).not.toContain('**');
	});
});

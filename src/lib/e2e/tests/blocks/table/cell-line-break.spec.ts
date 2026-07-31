import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const TABLE_1COL = '| H |\n| :- |\n| Left |\n';

test.describe('table cell Shift+Enter inserts <br>', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+Enter splits cell content with <br>; source preserves the tag', async ({ page }) => {
		await editor.loadContent(TABLE_1COL);
		// Focus the data cell (header is nth(0), data is nth(1) for a 1-column table).
		await page.locator('[role="cell"]').nth(1).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await editor.typeText('Right');

		await editor.bridge.waitForSourceContains('Left<br>Right');
		expect(await editor.bridge.getSource()).toContain('| Left<br>Right |');
	});

	// The caret sits right after the widget when Shift+Enter returns, so Backspace here is the
	// exact gesture that used to move the caret without deleting a byte — and whose second press
	// then ate a non-adjacent one.
	test('Backspace at the <br> edge removes the whole tag in one press', async ({ page }) => {
		await editor.loadContent(TABLE_1COL);
		await page.locator('[role="cell"]').nth(1).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await editor.typeText('Right');
		await editor.bridge.waitForSourceContains('Left<br>Right');
		// Back to the widget's trailing edge, one character at a time through 'Right'.
		for (let i = 0; i < 'Right'.length; i++) await page.keyboard.press('ArrowLeft');

		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceContains('| LeftRight |');
		// The neighbouring characters survive: the old second press deleted one of these.
		expect(await editor.bridge.getSource()).toContain('| LeftRight |');
		await expect(page.locator('[role="cell"]').nth(1).locator('.md-br-widget')).toHaveCount(0);
	});

	test('the inserted <br> renders as a visible widget, not literal text', async ({ page }) => {
		await editor.loadContent(TABLE_1COL);
		await page.locator('[role="cell"]').nth(1).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await editor.bridge.waitForSourceContains('Left<br>');

		const cell = page.locator('[role="cell"]').nth(1);
		await expect(cell.locator('.md-br-widget')).toHaveCount(1);
		await expect(cell).not.toContainText('<br>');
	});
});

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

	test('the inserted <br> renders as a visible widget, not literal text', async ({ page }) => {
		await editor.loadContent(TABLE_1COL);
		await page.locator('[role="cell"]').nth(1).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await editor.bridge.waitForSourceContains('Left<br>');

		const cell = page.locator('[role="cell"]').nth(1);
		await expect(cell.locator('.md-br-widget')).toHaveCount(1);
		// The literal "<br>" string must NOT appear as cell text.
		await expect(cell).not.toContainText('<br>');
	});
});

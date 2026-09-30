import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/table/pipeless-row.md`.

const SOURCE = '| a | b |\n| --- | --- |\n| 1 | 2 |\nPara one.\n';

test.describe('a line with no pipe after a table', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SOURCE);
	});

	test('loads as the table’s last row', async ({ page }) => {
		expect(await editor.bridge.getBlockCount()).toBe(1);
		const cells = page.locator('.table-cell');
		await expect(cells).toHaveCount(6);
		await expect(cells.nth(4)).toHaveText('Para one.');
		await expect(cells.nth(5)).toHaveText('');
	});

	test('typing in the row writes it back as a table row', async ({ page }) => {
		await page.locator('.table-cell').nth(4).click();
		await page.keyboard.press('End');
		await page.keyboard.type('X');

		await editor.bridge.waitForSourceContains('Para one.X');
		expect(await editor.bridge.getSource()).toBe(
			'| a | b |\n| --- | --- |\n| 1 | 2 |\n| Para one.X |  |\n'
		);
		expect(await editor.parseConverged()).toBe(true);
	});
});

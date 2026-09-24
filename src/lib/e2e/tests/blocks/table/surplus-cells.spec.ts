import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// A body row wider than the header keeps its extra cells through edits: the grid shows the
// header's column count, as GFM renders it, and no edit drops the bytes past it.
// Requirements: `e2e/requirements/blocks/table/surplus-cells.md`.

const WIDE = '| H0 |\n| --- |\n| x | y |\n| 1 |\n';

test.describe('a body row wider than the header', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(WIDE);
	});

	test('shows the header’s column count', async ({ page }) => {
		await expect(page.locator('.table-cell')).toHaveCount(3);
	});

	test('typing in the row keeps its extra cell', async ({ page }) => {
		await page.locator('.table-cell').nth(1).click();
		await page.keyboard.press('End');
		await page.keyboard.type('s');

		await expect.poll(() => editor.bridge.getSource()).toBe('| H0 |\n| --- |\n| xs | y |\n| 1 |\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('typing in another row keeps it through the table’s rebuild, and undo restores', async ({
		page
	}) => {
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('End');
		await page.keyboard.type('2');

		await expect.poll(() => editor.bridge.getSource()).toBe('| H0 |\n| --- |\n| x | y |\n| 12 |\n');
		await editor.undo();
		await expect.poll(() => editor.bridge.getSource()).toBe(WIDE);
	});

	test('deleting the header row widens the table to keep the promoted row’s cells', async ({
		page
	}) => {
		await page.locator('.table-cell').nth(0).click();
		await page.keyboard.press('ControlOrMeta+Shift+Backspace');

		await expect.poll(() => editor.bridge.getSource()).toBe('| x | y |\n| --- | --- |\n| 1 |  |\n');
		await expect(page.locator('.table-cell')).toHaveCount(4);
		expect(await editor.parseConverged()).toBe(true);

		await editor.undo();
		await expect.poll(() => editor.bridge.getSource()).toBe(WIDE);
		await expect(page.locator('.table-cell')).toHaveCount(3);
	});
});

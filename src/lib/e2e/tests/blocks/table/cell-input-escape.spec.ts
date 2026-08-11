import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const TABLE_2BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table block: cell input escapes pipes', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing a pipe escapes it so the row survives a reload', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click(); // body row 0, col 0 = "1"
		await page.keyboard.press('End');
		await page.keyboard.type('|');

		// Row 0's original bytes are gone once the commit lands.
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');

		const afterType = await editor.bridge.getSource();
		expect(afterType).toContain('| 1\\| | 2 |');

		// Post-reload equivalence: re-parsing the serialized source must be a fixed point. An
		// unescaped "| 1| | 2 |" reparses to three cells and truncates "2" away.
		await page.evaluate((src) => (window as any).__test.setSource(src), afterType);
		await editor.waitForRenderFlush();
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			afterType.replace(/\s+$/, '')
		);
	});

	test('typing continues correctly after an escaped pipe', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		await page.keyboard.type('x|y');

		// Caret stays consistent across the escape re-render: "y" lands after the
		// escaped pipe, not inside the `\|` pair.
		await editor.bridge.waitForSourceContains('| 1x\\|y | 2 |');
	});
});

import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';
import { capturePageErrors } from '../../../page-probes';

// Cells render row-major, header first: a 3-body-row 2-col table exposes cells 0,1 (header), 2,3
// (body row 1), 4,5 (body row 2), 6,7 (body row 3). Alt+↑/↓ reorders body rows only, since the
// header's position is fixed, and focus follows the moved row, staying in its column.
const TABLE_3BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';

test.describe('table block: keyboard row reorder', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('reorder is single-undo; reorder→undo→reorder keeps parity with no page error', async ({
		page
	}) => {
		const pageErrors = capturePageErrors(page);
		await editor.loadContent(TABLE_3BODY);

		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|/);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TABLE_3BODY);

		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|/);

		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});

	test('a successful row move announces the new position in the live region', async ({ page }) => {
		await editor.loadContent(TABLE_3BODY);
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		// First body row (CST row 1) moves to row 2 of a 3-body-row table.
		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(
			'Moved row to position 2 of 3'
		);
	});

	test('reorder keeps a tight table tight, and undo restores it byte-exactly', async ({ page }) => {
		const TIGHT = '|A|B|\n|---|---|\n|1|2|\n|3|4|\n';
		await editor.loadContent(TIGHT);
		// Compared against the loaded source, since `getSource()` normalizes trailing whitespace;
		// the `toContain` proves the load kept the tight cells (`|1|2|`).
		const original = await editor.bridge.getSource();
		expect(original).toContain('|1|2|');

		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/^\|A\|B\|\n\|---\|---\|\n\|3\|4\|\n\|1\|2\|/);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(original);
	});
});

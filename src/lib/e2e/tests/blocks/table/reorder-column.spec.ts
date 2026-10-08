import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';
import { capturePageErrors } from '../../../page-probes';

// Cells render row-major, header first: a 1-body-row 3-col table exposes header cells 0,1,2
// (columns A,B,C) then body cells 3,4,5. Columns have no fixed header, so any column index is a
// valid reorder source; Alt+←/→ moves the focused cell's column and focus follows it.
const TABLE_3COL = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';

test.describe('table block: keyboard column reorder', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('column move: container parity holds and no page error', async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		await editor.loadContent(TABLE_3COL);
		await page.locator('.table-cell').nth(0).click();
		await page.keyboard.press('Alt+ArrowRight');
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);

		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});

	// The row spec has the matching case.
	test('column move keeps a tight table tight, and undo restores it byte-exactly', async ({
		page
	}) => {
		const TIGHT = '|A|B|C|\n|---|---|---|\n|1|2|3|\n';
		await editor.loadContent(TIGHT);
		// Compare against the loaded source, not the literal: `getSource()` normalizes trailing
		// whitespace. The `toContain` proves the load kept the tight cells.
		const original = await editor.bridge.getSource();
		expect(original).toContain('|1|2|3|');

		await page.locator('.table-cell').nth(0).click();
		await page.keyboard.press('Alt+ArrowRight');
		await editor.bridge.waitForSourceMatches(/^\|B\|A\|C\|\n\|---\|---\|---\|\n\|2\|1\|3\|/);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(original);
	});

	test('a successful column move announces the new position in the live region', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('.table-cell').nth(0).click();
		await page.keyboard.press('Alt+ArrowRight');
		// Column 0 moves to index 1 of a 3-column table (1-based for the user).
		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(
			'Moved column to position 2 of 3'
		);
	});
});

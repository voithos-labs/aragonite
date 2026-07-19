import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';

// Cells render row-major, header first: a 1-body-row 3-col table exposes header
// cells 0,1,2 (columns A,B,C) then body cells 3,4,5. Columns have no fixed
// header, so any column index is a valid reorder source. Alt+←/→ moves the
// focused cell's column; focus follows it into the new position.
const TABLE_3COL = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';

test.describe('table block: keyboard column reorder', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Alt+ArrowRight moves a column right; source round-trips', async ({ page }) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+ArrowRight');
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);
	});

	test('Alt+ArrowLeft moves a column left', async ({ page }) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(2).click(); // header "C" (col 2)
		await page.keyboard.press('Alt+ArrowLeft');
		await editor.bridge.waitForSourceMatches(/\| A \| C \| B \|/);
	});

	test('column move keeps focus in the moved column (typing lands there)', async ({ page }) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(3).click(); // body cell "1" (row 1, col 0)
		await page.keyboard.press('Alt+ArrowRight');
		await editor.bridge.waitForSourceMatches(/\| 2 \| 1 \| 3 \|/);
		// Focus must have followed col 0 into col 1; otherwise X lands in the wrong cell.
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceMatches(/\| 2 \| (?:X1|1X) \| 3 \|/);
	});

	// Boundary clamp: a move with no column in that direction must change nothing
	// AND push no undo entry — otherwise the boundary press silently consumes a
	// Ctrl+Z. Type → boundary-press → Ctrl+Z must undo the TYPING.
	test('Alt+ArrowLeft on the first column is a no-op and creates no undo entry', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3COL);
		// A plain click lands the caret at the click position, so the marker may land
		// either side of the cell text — assert presence, not position.
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceMatches(/\| (?:ZA|AZ) \|/);

		await page.keyboard.press('Alt+ArrowLeft');
		await editor.waitForNoSourceMutation();
		await editor.bridge.waitForSourceMatches(/\| (?:ZA|AZ) \|/);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TABLE_3COL);
	});

	test('column move: container parity holds and no page error', async ({ page }) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+ArrowRight');
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);

		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});

	// Real-browser undo-restoration fidelity on a non-canonical table: the column
	// edit canonicalizes the live view, so undo must restore the exact original
	// tight bytes. Mirrors the row spec's non-canonical undo guard.
	test('column move → undo restores a non-canonical table byte-exactly', async ({ page }) => {
		const NONCANON = '|A|B|C|\n|---|---|---|\n|1|2|3|\n';
		await editor.loadContent(NONCANON);
		// Compare against the loaded source, not the literal — getSource() normalizes
		// trailing whitespace. toContain proves load did NOT canonicalize the cells.
		const original = await editor.bridge.getSource();
		expect(original).toContain('|1|2|3|');

		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+ArrowRight');
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(original);
	});

	test('a successful column move announces the new position in the live region', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+ArrowRight');
		// Column 0 moves to index 1 of a 3-column table (1-based for the user).
		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(
			'Moved column to position 2 of 3'
		);
	});
});

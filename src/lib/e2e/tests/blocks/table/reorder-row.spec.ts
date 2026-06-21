import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';

// Cells render row-major, header first: a 3-body-row 2-col table exposes cells
// 0,1 (header), 2,3 (body row 1), 4,5 (body row 2), 6,7 (body row 3). Alt+↑/↓
// reorders BODY rows only; the header is positionally fixed. Focus follows the
// moved row and stays in its column — a marker typed after the move lands there.
const TABLE_3BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';
const TABLE_2BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table block: keyboard row reorder', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Alt+ArrowDown swaps a body row past the next, focus stays in column', async ({ page }) => {
		await editor.loadContent(TABLE_3BODY);
		// First body row, second column.
		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|[\s\S]*\| 5 \| 6 \|/);
		// Focus follows the moved row and stays in column 1; typed marker lands there.
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('| 1 | X2 |');
	});

	test('Alt+ArrowUp moves an interior body row up', async ({ page }) => {
		await editor.loadContent(TABLE_3BODY);
		// Second body row, first column.
		await page.locator('[role="cell"]').nth(4).click();
		await page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|[\s\S]*\| 5 \| 6 \|/);
	});

	test('Alt+ArrowUp / Alt+ArrowDown from the header row does not mutate the source', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3BODY);
		await page.locator('[role="cell"]').nth(0).click();
		const before = await editor.bridge.getSource();

		await page.keyboard.press('Alt+ArrowDown');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);

		await page.keyboard.press('Alt+ArrowUp');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	// Boundary clamp: a move with no body row in that direction must change
	// nothing AND push no undo entry — otherwise the boundary press silently
	// consumes a Ctrl+Z. Type → boundary-press → Ctrl+Z must undo the TYPING.
	test('Alt+ArrowUp on the first body row is a no-op and creates no undo entry', async ({
		page
	}) => {
		await editor.loadContent(TABLE_2BODY);
		// A plain click lands the caret at the click position, not offset 0, so the
		// marker may land either side of the cell text — assert presence, not position.
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceMatches(/\| (?:Z1|1Z) \| 2 \|/);

		await page.keyboard.press('Alt+ArrowUp');
		await editor.waitForNoSourceMutation();
		await editor.bridge.waitForSourceMatches(/\| (?:Z1|1Z) \| 2 \|/);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TABLE_2BODY);
		await editor.bridge.waitForSourceNotContains('Z');
	});

	test('Alt+ArrowDown on the last body row is a no-op', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(4).click();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('reorder is single-undo; reorder→undo→reorder keeps parity with no page error', async ({
		page
	}) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));
		await editor.loadContent(TABLE_3BODY);

		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|/);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TABLE_3BODY);

		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|/);

		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});

	test('a successful row move announces the new position in the live region', async ({ page }) => {
		await editor.loadContent(TABLE_3BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		// First body row (CST row 1) moves to row 2 of a 3-body-row table.
		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(
			'Moved row to position 2 of 3'
		);
	});

	// Guards the `ensureUnsharedChildren` line in moveRow: reorder's
	// rebuildTableRaw canonicalizes every row's raw, so without the unshare it
	// writes THROUGH snapshot-shared rows and undo restores CANONICAL bytes. On a
	// tight, unpadded table the original is non-canonical, so a corrupted undo is
	// observable as a byte mismatch. RED if the unshare line is removed.
	test('reorder→undo restores non-canonical source byte-exactly (unshare guard)', async ({
		page
	}) => {
		const NONCANON = '|A|B|\n|---|---|\n|1|2|\n|3|4|\n';
		await editor.loadContent(NONCANON);
		// Compare against the loaded source, not the literal — getSource() normalizes
		// trailing whitespace. toContain proves load did NOT canonicalize the cells
		// (canonical is `| 1 | 2 |`, which does not contain `|1|2|`); without that the
		// test couldn't discriminate the unshare line.
		const original = await editor.bridge.getSource();
		expect(original).toContain('|1|2|');

		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|/);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(original);
	});
});

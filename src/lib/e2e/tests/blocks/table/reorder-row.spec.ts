import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';
import { capturePageErrors } from '../../../page-probes';

// Cells render row-major, header first: a 3-body-row 2-col table exposes cells 0,1 (header), 2,3
// (body row 1), 4,5 (body row 2), 6,7 (body row 3). Alt+↑/↓ reorders BODY rows only — the header is
// positionally fixed — and focus follows the moved row, staying in its column.
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

	// Boundary clamp: a move with no body row in that direction must change nothing AND push no
	// undo entry, or the boundary press silently consumes a Ctrl+Z. Type → boundary-press → Ctrl+Z
	// must undo the TYPING.
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
		const pageErrors = capturePageErrors(page);
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

	// Real-browser undo fidelity on a non-canonical table: reorder's rebuildTableRaw canonicalizes
	// the live view, so undo must restore the exact original tight bytes. A single reorder→undo
	// does NOT exercise moveRow's `ensureUnsharedChildren` — that snapshot aliasing needs a prior
	// shared snapshot.
	test('reorder→undo restores a non-canonical table source byte-exactly', async ({ page }) => {
		const NONCANON = '|A|B|\n|---|---|\n|1|2|\n|3|4|\n';
		await editor.loadContent(NONCANON);
		// Compare against the loaded source, not the literal — getSource() normalizes trailing
		// whitespace. toContain proves load did NOT canonicalize the cells (canonical `| 1 | 2 |`
		// does not contain `|1|2|`).
		const original = await editor.bridge.getSource();
		expect(original).toContain('|1|2|');

		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|/);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(original);
	});
});

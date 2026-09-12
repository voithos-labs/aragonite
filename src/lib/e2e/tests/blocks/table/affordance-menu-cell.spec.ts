import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openFlyout } from './helpers';

// Cells render row-major with the header cells first, so for TABLE the role="cell"
// order is: 0=A 1=B (header) · 2="1" 3="2" (body row 1) · 4="3" 5="4" (body row 2).
const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_3COL = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';
const TABLE_1X1 = '| A |\n| --- |\n| 1 |\n';

test.describe('table block: cell right-click menu', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('right-click a cell opens the menu with BOTH row and column actions', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' }); // body cell ("1"), row 1 col 0

		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /delete column/i })).toBeVisible();
	});

	test('Delete column removes the clicked cell column (colIdx routing)', async ({ page }) => {
		await page.locator('[role="cell"]').nth(1).click({ button: 'right' }); // header cell B, col 1
		await page.getByRole('menuitem', { name: /delete column/i }).click();

		await editor.bridge.waitForSourceMatches(/\| A \|\s*$/m); // only column A remains
		await editor.bridge.waitForSourceNotContains(' B ');
	});

	test('Delete row removes the clicked cell row (rowIdx routing)', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' }); // body cell ("1"), row 1
		await page.getByRole('menuitem', { name: /delete row/i }).click();

		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		expect(await editor.bridge.getSource()).toContain('| 3 | 4 |');
	});

	// Prose has a right-click menu of its own (clipboard), so the oracle is the table's items.
	test('right-clicking outside the table does not open the affordance menu', async ({ page }) => {
		await editor.loadContent(`${TABLE}text below\n`);
		await page.getByText('text below').click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /delete row/i })).toHaveCount(0);
		await expect(page.getByRole('menuitem', { name: /delete column/i })).toHaveCount(0);
	});

	test('right-click within an active intra-table rectangle preserves the rectangle', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click(); // body ("1"), row 1 col 0
		await page
			.locator('[role="cell"]')
			.nth(5)
			.click({ modifiers: ['Shift'] }); // ("4"), row 2 col 1
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		// onPointerDown's selection clear must skip the right button, not run for any.
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menu')).toBeVisible();
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	// ── Row and Column flyouts ─────────────────────────────────────────────
	//
	// The insert/move actions live one level down, behind the "Row" and "Column" rows; a
	// hover opens the flyout, the same way the pointer really reaches them. These cover the
	// action semantics the grip menus used to own, now routed off the clicked cell.

	test('the Row flyout inserts a body row directly below the clicked row', async ({ page }) => {
		await openFlyout(page, 2, 'Row'); // body cell ("1"), rowIdx 1
		await page.getByRole('menuitem', { name: 'Insert row below' }).click();

		await editor.bridge.waitForSourceMatches(/\| 1 \| 2 \|\n\|[^|\n]*\|[^|\n]*\|\n\| 3 \| 4 \|/);
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('the Column flyout inserts a column directly right of the clicked column', async ({
		page
	}) => {
		await openFlyout(page, 0, 'Column'); // header cell A, colIdx 0
		await page.getByRole('menuitem', { name: 'Insert column right' }).click();

		await editor.bridge.waitForSourceContains('| A |  | B |');
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('the Row flyout moves the clicked row past the next one', async ({ page }) => {
		await openFlyout(page, 2, 'Row'); // body cell ("1"), rowIdx 1
		await page.getByRole('menuitem', { name: 'Move row down' }).click();

		// Full-pair anchor: the swap failed if "1 | 2" is still the first body row.
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|\n\| 1 \| 2 \|/);
	});

	test('the Column flyout moves the clicked column past the next one', async ({ page }) => {
		await openFlyout(page, 0, 'Column'); // header cell A, colIdx 0
		await page.getByRole('menuitem', { name: 'Move column right' }).click();

		await editor.bridge.waitForSourceContains('| B | A |');
		await editor.bridge.waitForSourceContains('| 2 | 1 |');
	});

	// One menu, both flyouts: the first body row cannot move up and the first column cannot
	// move left, and neither disabled row is reachable as a commit.
	test('moves are disabled at the near end of each axis', async ({ page }) => {
		await openFlyout(page, 2, 'Row'); // rowIdx 1 (first body row), colIdx 0 (first column)
		await expect(page.getByRole('menuitem', { name: 'Move row up' })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: 'Move row down' })).toBeEnabled();

		// Hovering the sibling group row swaps which flyout is open.
		await page.getByRole('menuitem', { name: 'Column', exact: true }).hover();
		await expect(page.getByRole('menuitem', { name: 'Move column left' })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: 'Move column right' })).toBeEnabled();
	});

	test('both deletes are disabled in a one-row, one-column table', async ({ page }) => {
		await editor.loadContent(TABLE_1X1);
		await page.locator('[role="cell"]').nth(1).click({ button: 'right' }); // the sole body cell

		const deleteRow = page.getByRole('menuitem', { name: /delete row/i });
		const deleteColumn = page.getByRole('menuitem', { name: /delete column/i });
		await expect(deleteRow).toBeDisabled();
		await expect(deleteColumn).toBeDisabled();

		// A disabled row can never reach a commit, even when the click is forced onto it.
		const before = await editor.bridge.getSource();
		await deleteRow.click({ force: true });
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	// Alignment stays top-level in the cell menu (it is not folded into the Column flyout).
	test("the alignment control aligns the clicked cell's column", async ({ page }) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(1).click({ button: 'right' }); // header cell B, colIdx 1
		await page.getByRole('button', { name: 'Center' }).click();

		// Full-row anchor: only B is `:-+:`; A and C stay `-+`, so the test fails if alignment
		// routes to column 0 or 2 instead of the clicked column 1.
		await editor.bridge.waitForSourceMatches(/^\| -+ \| :-+: \| -+ \|$/m);
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	// Keyboard alignment once dropped focus to <body> and announced nothing: activating a segment
	// must return focus to a cell and announce via the live region. Driven through the menu's real
	// roving focus, not a programmatic press on the segment.
	test('keyboard-driven alignment restores focus to a cell and announces', async ({ page }) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(4).click(); // body row, column B ("2")
		await page.keyboard.press('Shift+F10');
		await expect(page.getByRole('menu')).toBeVisible();

		const focused = page.locator('[role="menu"] :focus');
		await page.keyboard.press('ArrowUp'); // wraps to the last stop, the Right segment
		await expect(focused).toHaveAttribute('aria-label', 'Right');
		await page.keyboard.press('ArrowLeft');
		await expect(focused).toHaveAttribute('aria-label', 'Center');
		await page.keyboard.press('Enter');

		await expect(page.getByRole('menu')).toHaveCount(0);
		await editor.bridge.waitForSourceMatches(/^\| -+ \| :-+: \| -+ \|$/m);
		await expect(page.locator(':focus')).toHaveAttribute('role', 'cell');
		await expect(page.locator('.editor-sr-live-reorder')).toContainText('Column aligned center');
	});
});

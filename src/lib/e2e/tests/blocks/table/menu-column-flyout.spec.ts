import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openFlyout } from './helpers';

// Header + 1 body row, 3 columns. Cells render row-major, header first: nth 0,1,2 = header A,B,C
// and nth 3,4,5 = body 1,2,3. The Column flyout is the pointer road for the column actions the
// chords also reach; requirements/blocks/table/menu-column-flyout.md.
const TABLE_3COL = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';
const TABLE_1COL = '| A |\n| --- |\n| 1 |\n| 2 |\n';

test.describe('table block: the cell menu’s Column flyout', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_3COL);
	});

	test('Insert column left adds a column before the clicked column', async ({ page }) => {
		await openFlyout(page, 1, 'Column'); // header B, colIdx 1
		await page.getByRole('menuitem', { name: 'Insert column left' }).click();

		await editor.bridge.waitForSourceContains('| A |  | B | C |');
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('Move column left moves an interior column past the previous one', async ({ page }) => {
		await openFlyout(page, 1, 'Column'); // header B, colIdx 1
		await page.getByRole('menuitem', { name: 'Move column left' }).click();

		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);
		await editor.bridge.waitForSourceMatches(/\| 2 \| 1 \| 3 \|/);
	});

	test('Move column right is disabled on the last column', async ({ page }) => {
		await openFlyout(page, 2, 'Column'); // header C, the last column
		await expect(page.getByRole('menuitem', { name: 'Move column right' })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: 'Move column left' })).toBeEnabled();
	});

	// One axis at its floor does not disable the other: the column delete is refused, the row
	// delete beside it stays live.
	test('Delete column is disabled for the only column while Delete row stays enabled', async ({
		page
	}) => {
		await editor.loadContent(TABLE_1COL);
		await page.locator('[role="cell"]').nth(1).click({ button: 'right' }); // body cell "1"

		await expect(page.getByRole('menuitem', { name: /delete column/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeEnabled();
	});

	test('a flyout column move is a single undo entry', async ({ page }) => {
		await openFlyout(page, 0, 'Column');
		await page.getByRole('menuitem', { name: 'Move column right' }).click();
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TABLE_3COL);
	});

	// The menu took focus to open; the move must hand the caret back to the moved column, in
	// the row it was clicked in, or the next keystroke lands nowhere.
	test('typing after a flyout column move lands in the moved column', async ({ page }) => {
		await openFlyout(page, 3, 'Column'); // body cell "1": rowIdx 1, colIdx 0
		await page.getByRole('menuitem', { name: 'Move column right' }).click();
		await editor.bridge.waitForSourceMatches(/\| 2 \| 1 \| 3 \|/);

		await page.keyboard.type('X');
		await editor.bridge.waitForSourceMatches(/\| 2 \| (?:X1|1X) \| 3 \|/);
	});

	test('the alignment trio reflects the clicked column’s current alignment', async ({ page }) => {
		await editor.loadContent('| A | B |\n| :---: | --- |\n| 1 | 2 |\n');
		await page.locator('[role="cell"]').nth(0).click({ button: 'right' }); // centred column A

		const trio = page.getByRole('group', { name: 'Column alignment' });
		await expect(trio.locator('.alignment-segment.active')).toHaveAttribute('aria-label', 'Center');
	});

	test('the alignment trio sets the clicked (non-first) column to right', async ({ page }) => {
		await page.locator('[role="cell"]').nth(1).click({ button: 'right' }); // header B, colIdx 1
		await page.getByRole('button', { name: 'Right' }).click();

		// Full-row anchor: only B is `-+:`; A and C stay `-+`, so the test fails if alignment
		// routes to column 0 or 2 instead of the clicked column 1.
		await editor.bridge.waitForSourceMatches(/^\| -+ \| -+: \| -+ \|$/m);
		await expect(page.getByRole('menu')).toHaveCount(0);
	});
});

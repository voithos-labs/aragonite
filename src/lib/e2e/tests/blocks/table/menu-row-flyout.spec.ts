import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openFlyout } from './helpers';

// Cells render row-major, header first: 0=A 1=B · 2="1" 3="2" (body row 1) · 4="3" 5="4" (body
// row 2). The Row flyout is the pointer road for the row actions the chords also reach;
// requirements/blocks/table/menu-row-flyout.md.
const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_1ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

test.describe('table block: the cell menu’s Row flyout', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('Insert row above adds a body row before the clicked row', async ({ page }) => {
		await openFlyout(page, 2, 'Row'); // body cell "1", rowIdx 1
		await page.getByRole('menuitem', { name: 'Insert row above' }).click();

		await editor.bridge.waitForSourceMatches(
			/\| A \| B \|\n\| --- \| --- \|\n\|[^|\n]*\|[^|\n]*\|\n\| 1 \| 2 \|/
		);
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('Move row up moves an interior body row above the previous one', async ({ page }) => {
		await openFlyout(page, 4, 'Row'); // body cell "3", rowIdx 2
		await page.getByRole('menuitem', { name: 'Move row up' }).click();

		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|\n\| 1 \| 2 \|/);
	});

	// The header is positionally fixed: its flyout inserts around it but moves nothing.
	test('the header row offers inserts but no move in either direction', async ({ page }) => {
		await openFlyout(page, 0, 'Row');

		await expect(page.getByRole('menuitem', { name: 'Insert row below' })).toBeEnabled();
		await expect(page.getByRole('menuitem', { name: 'Move row up' })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: 'Move row down' })).toBeDisabled();
	});

	test('Move row down is disabled on the last body row', async ({ page }) => {
		await openFlyout(page, 4, 'Row'); // last body row
		await expect(page.getByRole('menuitem', { name: 'Move row down' })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: 'Move row up' })).toBeEnabled();
	});

	// One axis at its floor does not disable the other: the row delete is refused, the column
	// delete beside it stays live.
	test('Delete row is disabled for the only body row while Delete column stays enabled', async ({
		page
	}) => {
		await editor.loadContent(TABLE_1ROW);
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' }); // the sole body row

		const deleteRow = page.getByRole('menuitem', { name: /delete row/i });
		await expect(deleteRow).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /delete column/i })).toBeEnabled();

		const before = await editor.bridge.getSource();
		await deleteRow.click({ force: true });
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('a flyout move is a single undo entry', async ({ page }) => {
		await openFlyout(page, 2, 'Row');
		await page.getByRole('menuitem', { name: 'Move row down' }).click();
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|\n\| 1 \| 2 \|/);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TABLE);
	});

	// The menu took focus to open; the move must hand the caret back to the moved row, in the
	// column it was clicked in, or the next keystroke lands nowhere.
	test('typing after a flyout move lands in the moved row', async ({ page }) => {
		await openFlyout(page, 3, 'Row'); // body cell "2": rowIdx 1, colIdx 1
		await page.getByRole('menuitem', { name: 'Move row down' }).click();
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|\n\| 1 \| 2 \|/);

		await page.keyboard.type('X');
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|\n\| 1 \| (?:X2|2X) \|/);
	});
});

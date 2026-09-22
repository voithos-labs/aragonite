import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { capturePageErrors } from '../../../page-probes';

// Entering a row-windowed table with a sticky column must read the column geometry from a mounted
// row, not a hardcoded row 0: an unmounted row 0 gives no rects and `columnNearestX` collapses the
// caret to column 0 (VR-K1).
test.describe('table block: sticky-column entry into a row-windowed table', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		// Fixed viewport so the windowed mount set is deterministic, matching the VR table suite. A
		// 2MB table clears the 4000px watermark at any height, but pinning the geometry keeps the
		// precondition unambiguous.
		await page.setViewportSize({ width: 1280, height: 900 });
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowUp from below lands the nearest-X column, not column 0, when row 0 is windowed out', async ({
		page
	}) => {
		// Row-windowing settles are layout-bound on a 2MB load; give the same headroom the VR table
		// suite uses.
		test.setTimeout(120_000);

		const pageErrors = capturePageErrors(page);

		// Trailing paragraph below the table: ArrowDown out of the last row captures
		// the sticky-X, ArrowUp re-enters the last row via focusAtColumn(x, 'below').
		await editor.loadLargeFixture('giant-single-table', 2_000_000, '\nbelow paragraph\n');

		const lastRow = await page.evaluate(
			() => (window as any).__test.getDocument().children[0].children.length - 1
		);

		// Scroll to the bottom so the last row and the trailing paragraph mount while
		// row 0 windows out.
		const scrollHeight = await page.evaluate(
			() => (document.querySelector('.editor') as HTMLElement).scrollHeight
		);
		await editor.scrollEditorTo(scrollHeight);

		// Click the rightmost cell (col 2 of the 3-column fixture): the sticky x then maps
		// clearly to col 2, so a landing in col 0 stands out.
		const rightCol = 2;
		await page.locator(`[data-table-row-idx="${lastRow}"] .table-cell`).nth(rightCol).click();

		// ArrowDown exits to the paragraph below, capturing the sticky x at col 2. No
		// typing in between: input events reset the sticky column.
		await page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		// The precondition at the decisive moment: row 0 unmounted and the table windowed, or this
		// passes vacuously, since a read of row 0 only fails when row 0 is really unmounted.
		expect(
			await page.evaluate(() => document.querySelector('[data-table-row-idx="0"]'))
		).toBeNull();
		expect(
			await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
		).toBeGreaterThan(0);

		await page.keyboard.press('ArrowUp');
		await editor.waitForRenderFlush();

		// The check: the focus path is [tableIdx, rowIdx, colIdx, ...]. The caret must land in
		// col 2, nearest the sticky x, not col 0, which is what an empty set of rects falls to.
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path[1]).toBe(lastRow);
		expect(sel!.focus.path[2]).toBe(rightCol);
		expect(pageErrors).toEqual([]);
	});
});

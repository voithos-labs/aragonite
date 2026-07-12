import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// VR-K1: sticky-column entry into a row-windowed table must read column geometry
// from a MOUNTED row, not hard-coded row 0. With the table scrolled past row 0,
// row 0 is unmounted; reading its rects yields [] and columnNearestX([]) collapses
// the caret to column 0, losing the sticky-X intent.
test.describe('table block: sticky-column entry into a row-windowed table', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		// Fixed viewport so the windowed mount set is deterministic, matching the VR
		// table suite. A 2MB table clears the 4000px activation watermark at any
		// height, but pinning the geometry keeps the precondition unambiguous.
		await page.setViewportSize({ width: 1280, height: 900 });
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowUp from below lands the nearest-X column, not column 0, when row 0 is windowed out', async ({
		page
	}) => {
		// A 2MB load + scroll-to-bottom + render flushes runs comfortably under the
		// 30s default in practice, but row-windowing settles are layout-bound; give
		// the same headroom the VR table suite uses.
		test.setTimeout(120_000);

		const pageErrors: string[] = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));

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

		// Click the RIGHTMOST cell (col 2 of the 3-col fixture): the sticky-X then maps
		// unambiguously to col 2, so the bug's col-0 landing is maximally distinguishable.
		const rightCol = 2;
		await page.locator(`[data-table-row-idx="${lastRow}"] [role="cell"]`).nth(rightCol).click();

		// ArrowDown exits to the paragraph below, capturing the sticky-X at col 2. No
		// typing in between — input events reset the sticky column.
		await page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		// Load-bearing precondition AT THE DECISIVE INSTANT: row 0 unmounted and the
		// table windowed. Without this the mutation-revert could pass vacuously (the
		// buggy row-0 read only fails when row 0 is genuinely off-window).
		expect(
			await page.evaluate(() => document.querySelector('[data-table-row-idx="0"]'))
		).toBeNull();
		expect(
			await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
		).toBeGreaterThan(0);

		// ArrowUp re-enters the last row at the sticky-X column.
		await page.keyboard.press('ArrowUp');
		await editor.waitForRenderFlush();

		// Oracle: the focus path is [tableIdx, rowIdx, colIdx, ...]. The caret must land
		// in col 2 (nearest the sticky-X), NOT col 0 — the bug's empty-rects fallback.
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path[1]).toBe(lastRow);
		expect(sel!.focus.path[2]).toBe(rightCol);
		expect(pageErrors).toEqual([]);
	});
});

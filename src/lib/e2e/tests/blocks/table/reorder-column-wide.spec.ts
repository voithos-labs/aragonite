import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// 12 columns at ~150px each overflow `.table-block`'s overflow-x in an 800px viewport, so the late
// columns start scrolled off the right edge. A column moved into that region carries the caret
// with it, and the caret's cell must scroll into view or the move lands out of sight.
// Requirements: requirements/blocks/table/reorder-column-wide.md.
const COLS = 12;
const HEAD =
	'| ' + Array.from({ length: COLS }, (_, i) => `Header-Col-${i + 1}`).join(' | ') + ' |\n';
const SEP = '| ' + Array.from({ length: COLS }, () => '---').join(' | ') + ' |\n';
const ROW = (prefix: string) =>
	'| ' + Array.from({ length: COLS }, (_, i) => `${prefix}${i + 1}`).join(' | ') + ' |\n';
const WIDE_TABLE = HEAD + SEP + ROW('a') + ROW('b');

test.describe('table block: column move on a wide (overflowing) table', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 800, height: 720 });
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Alt+ArrowRight into the clipped region scrolls the moved column into view', async ({
		page
	}) => {
		await editor.loadContent(WIDE_TABLE);
		const tableEl = page.locator('[role="table"]').first();

		// Precondition: columns actually overflow, or the off-screen claim is vacuous.
		expect(await tableEl.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

		// The rightmost header cell fully visible at scrollLeft 0; its right neighbour is clipped.
		const last = await page.evaluate(() => {
			const table = document.querySelector('[role="table"]') as HTMLElement;
			const tableRect = table.getBoundingClientRect();
			const cells = [...table.querySelectorAll('[data-table-row-idx="0"] > [role="cell"]')];
			let maxVisible = -1;
			cells.forEach((c, i) => {
				const r = c.getBoundingClientRect();
				if (r.left >= tableRect.left && r.right <= tableRect.right) maxVisible = i;
			});
			return maxVisible;
		});
		expect(last).toBeGreaterThan(0);
		expect(last).toBeLessThan(COLS - 1);

		await page.locator('[role="cell"]').nth(last).click();
		await page.keyboard.press('Alt+ArrowRight');

		// Insert semantics: the column swaps past its clipped neighbour.
		await editor.bridge.waitForSourceMatches(
			new RegExp(`Header-Col-${last + 2} \\| Header-Col-${last + 1}`)
		);
		// The caret rode the column into the clipped region, and the grid scrolled to show it.
		const focusedCellVisible = await page.evaluate(() => {
			const cell = document.activeElement?.closest('[role="cell"]');
			const table = cell?.closest('[role="table"]');
			if (!cell || !table) return null;
			const r = cell.getBoundingClientRect();
			const t = table.getBoundingClientRect();
			return r.left >= t.left - 1 && r.right <= t.right + 1;
		});
		expect(focusedCellVisible, 'the moved column is the focused cell, in view').toBe(true);
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceMatches(
			new RegExp(`\\| (?:XHeader-Col-${last + 1}|Header-Col-${last + 1}X) \\|`)
		);
	});
});

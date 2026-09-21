import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Tables, run in the default gate. A table is the hardest kind for reactive state: a container
// of keyed children whose rows are themselves containers of keyed children, and nothing else in
// the gate moves rows and columns of a live one.
//
// Drives a loaded table, since typed pipe syntax never renders an interactive one (see
// gestures/table.ts). It starts with a column operation, which writes to every row at once, and
// includes an undo of one, which clones each row's children: the two hardest cases.

// The first paragraph is where the gesture that extends a selection into the table starts.
// Every cell below is addressed within the grid, so the extra block shifts nothing.
const START_TABLE = 'Intro line above.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

async function columnCount(page: Page): Promise<number> {
	return page.evaluate(() => {
		const row = document.querySelector('[data-table-row-idx]');
		return row ? row.querySelectorAll('[role="cell"]').length : 0;
	});
}

test.describe('note-taking simulation: table row/column moves', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('row/column moves keep the live tree round-trip-stable and state-consistent', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(START_TABLE);
		await editor.waitForRenderFlush();
		await expect(page.locator('.table-block')).toHaveCount(1);

		const ctx = await makeSimContext(page, editor, 'table-ops', { errors });
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = (label: string) => assertCoreOracles(ctx, label);

		// 2 columns by 3 rows (a header and two body rows). Cells are counted across rows:
		// header 0 and 1, first body row 2 and 3, second 4 and 5.
		await g.insertColumnRight(0);
		await checkOracles('after-insert-column');
		expect(await columnCount(page)).toBe(3);

		// Edit the new empty header cell (index 1 in a header row of three).
		await g.editCell(1, 'C');
		await checkOracles('after-edit-cell');

		// Insert a body row below the first one. With three columns, the first body row's
		// first cell is index 3, since the header takes 0 to 2.
		await g.insertRowBelow(3);
		await checkOracles('after-insert-row');

		// Delete the row just inserted (its first cell is index 6).
		await g.deleteRow(6);
		await checkOracles('after-delete-row');
		expect(await columnCount(page)).toBe(3);

		// Delete the middle column, clicking any body cell in column 1, which is index 4.
		await g.deleteColumn(4);
		await checkOracles('after-delete-column');
		expect(await columnCount(page)).toBe(2);

		// Undo the deleted column: cloning replaces every container, so the state registry and
		// each row's child ids have to follow, or the nested state goes out of step.
		await g.undo();
		await checkOracles('after-undo');
		expect(await columnCount(page)).toBe(3);

		// Extending a selection into the table (G2.12) opens the cell it reaches and puts the
		// caret there, and the whole detour moves no bytes.
		await g.liveExtendIntoTablePark();
		await checkOracles('after-live-extend-park');
	});
});

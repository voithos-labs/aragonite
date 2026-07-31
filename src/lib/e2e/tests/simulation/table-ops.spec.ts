import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { type SimContext, assertCoreOracles } from '../../simulation/invariants';

// Ungated table proxy-class oracle. Tables are the most proxy-prone kind: keyed-children
// containers whose rows are themselves keyed sub-containers, and no other gate exercises a
// live one through real row/column moves.
//
// Drives a LOADED table (typed pipe syntax never renders an interactive one — see
// gestures/table.ts), leading with a column op (the per-row commitMultiScope path) and
// including an undo of one (the identity-survivor / childIds-clone path) — the two richest
// proxy-class stressors.

const START_TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

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

		const tracker = new ExpectationTracker(await editor.bridge.getSource());
		const ctx: SimContext = { page, editor, tracker, errors, label: 'table-ops' };
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = (label: string) => assertCoreOracles(ctx, label);

		// 2 cols × 3 rows (header + 2 body). Cells are row-major: header 0,1;
		// row1 2,3; row2 4,5.
		await g.insertColumnRight(0);
		await checkOracles('after-insert-column');
		expect(await columnCount(page)).toBe(3);

		// Edit the new empty header cell (index 1 in a 3-col header row).
		await g.editCell(1, 'C');
		await checkOracles('after-edit-cell');

		// Insert a body row below the first body row. With 3 cols the first body
		// row's first cell is index 3 (header occupies 0..2).
		await g.insertRowBelow(3);
		await checkOracles('after-insert-row');

		// Delete the row just inserted (its first cell is index 6).
		await g.deleteRow(6);
		await checkOracles('after-delete-row');
		expect(await columnCount(page)).toBe(3);

		// Delete the middle column (click any body cell in column 1 — index 4).
		await g.deleteColumn(4);
		await checkOracles('after-delete-column');
		expect(await columnCount(page)).toBe(2);

		// Undo the delete-column: cloneNode swaps every container identity, so the
		// state-registry and per-row childIds must follow or nested state desyncs.
		await g.undo();
		await checkOracles('after-undo');
		expect(await columnCount(page)).toBe(3);
	});
});

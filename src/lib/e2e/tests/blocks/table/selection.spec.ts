import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

async function dragBetweenCells(page: Page, fromIdx: number, toIdx: number): Promise<void> {
	const from = page.locator('[role="cell"]').nth(fromIdx);
	const to = page.locator('[role="cell"]').nth(toIdx);
	const fromBox = await from.boundingBox();
	const toBox = await to.boundingBox();
	if (!fromBox || !toBox) throw new Error('dragBetweenCells: missing bounding box');
	const sx = fromBox.x + fromBox.width / 2;
	const sy = fromBox.y + fromBox.height / 2;
	const ex = toBox.x + toBox.width / 2;
	const ey = toBox.y + toBox.height / 2;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) {
		const t = i / 10;
		await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
	}
	await page.mouse.up();
}

test.describe('table block: selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_3x3);
	});

	test('drag cell A → cell B enters cross-block selection on the table', async ({ page }) => {
		await dragBetweenCells(page, 0, 8);
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		// Both endpoints land inside the table at index 0; rectangular vs linear
		// is decided downstream and does not matter for cross-block entry.
		expect(sel!.anchor.path[0]).toBe(0);
		expect(sel!.focus.path[0]).toBe(0);
		const sameEndpoints =
			sel!.anchor.path.length === sel!.focus.path.length &&
			sel!.anchor.path.every((v, i) => v === sel!.focus.path[i]) &&
			sel!.anchor.offset === sel!.focus.offset;
		expect(sameEndpoints).toBe(false);
	});

	test('shift+click cell A → cell B enters cross-block selection on the table', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.locator('[role="cell"]').nth(8).click({ modifiers: ['Shift'] });
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.path[0]).toBe(0);
		expect(sel!.focus.path[0]).toBe(0);
	});

	test.fixme(
		'drag intra-cell paints native selection (no cross-block overlay)',
		async () => {
			// drag-pointer's blockAtPoint resolves any point inside the table to
			// the table's own data-block-path, not the cell's deeper path. The
			// "still in anchor block — let native handle it" branch never fires
			// for cell anchors, so an intra-cell drag spuriously enters
			// cross-block and clears the native selection. Resolves alongside
			// the drag-back collapse fix above.
		}
	);

	test.fixme(
		'drag cell A → cell B → back to A collapses selection',
		async () => {
			// drag-pointer's "return to anchor block collapses" branch keys on
			// data-block-path equality. Cells don't carry data-block-path, so
			// returning to the anchor cell never triggers collapse. Resolves once
			// drag-pointer learns table cells (Plan 4 keyboard vocabulary or a
			// follow-up patch to drag-pointer).
		}
	);

	test('drag from cell out into paragraph below enters cross-block', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n');
		const cell = page.locator('[role="cell"]').nth(0);
		const para = page.getByText('After.');
		const cellBox = await cell.boundingBox();
		const paraBox = await para.boundingBox();
		if (!cellBox || !paraBox) throw new Error('missing boxes');
		const sx = cellBox.x + cellBox.width / 2;
		const sy = cellBox.y + cellBox.height / 2;
		const ex = paraBox.x + paraBox.width / 2;
		const ey = paraBox.y + paraBox.height / 2;
		await page.mouse.move(sx, sy);
		await page.mouse.down();
		for (let i = 1; i <= 12; i++) {
			const t = i / 12;
			await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
		}
		await page.mouse.up();
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.path[0]).toBe(0);
		expect(sel!.focus.path[0]).toBe(1);
	});

	test('drag from paragraph above into table enters cross-block', async ({ page }) => {
		await editor.loadContent('Before.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const para = page.getByText('Before.');
		const cell = page.locator('[role="cell"]').last();
		const paraBox = await para.boundingBox();
		const cellBox = await cell.boundingBox();
		if (!paraBox || !cellBox) throw new Error('missing boxes');
		const sx = paraBox.x + 5;
		const sy = paraBox.y + paraBox.height / 2;
		const ex = cellBox.x + cellBox.width / 2;
		const ey = cellBox.y + cellBox.height / 2;
		await page.mouse.move(sx, sy);
		await page.mouse.down();
		for (let i = 1; i <= 12; i++) {
			const t = i / 12;
			await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
		}
		await page.mouse.up();
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.path[0]).toBe(0);
		expect(sel!.focus.path[0]).toBe(1);
	});

	test.fixme(
		'rectangular intra-table drag paints overlay across the rectangle',
		async () => {
			// Plan 4 (keyboard vocabulary) wires the input mechanism that produces
			// path-equal anchor/focus with cell-index offsets — the precondition for
			// TableBlock.measurePartialRects to take its rectangular branch and for
			// the overlay to paint cell rects across the rectangle.
		}
	);

	test.fixme(
		'anti-diagonal rectangular selection paints full bounding rect (regression for b840b18)',
		async () => {
			// Plan 4 dependency — see above. Once a rectangular selection can be
			// produced from input, anti-diagonal anchor/focus must still paint the
			// full row × col rectangle (not the empty set the pre-fix returned).
		}
	);
});

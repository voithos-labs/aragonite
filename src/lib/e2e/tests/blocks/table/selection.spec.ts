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

	test('drag intra-cell paints native selection (no cross-block overlay)', async ({ page }) => {
		const cell = page.locator('[role="cell"]').nth(4);
		const box = await cell.boundingBox();
		if (!box) throw new Error('missing cell box');
		const sx = box.x + 4;
		const ex = box.x + box.width - 4;
		const y = box.y + box.height / 2;
		await page.mouse.move(sx, y);
		await page.mouse.down();
		for (let i = 1; i <= 6; i++) {
			await page.mouse.move(sx + ((ex - sx) * i) / 6, y);
		}
		await page.mouse.up();
		await editor.waitForCrossBlock(false);
		expect(await page.locator('.selection-overlay').count()).toBe(0);
	});

	test('drag cell A → cell B → back to A collapses selection', async ({ page }) => {
		const a = page.locator('[role="cell"]').nth(0);
		const b = page.locator('[role="cell"]').nth(8);
		const aBox = await a.boundingBox();
		const bBox = await b.boundingBox();
		if (!aBox || !bBox) throw new Error('missing boxes');
		const ax = aBox.x + aBox.width / 2;
		const ay = aBox.y + aBox.height / 2;
		const bx = bBox.x + bBox.width / 2;
		const by = bBox.y + bBox.height / 2;
		await page.mouse.move(ax, ay);
		await page.mouse.down();
		for (let i = 1; i <= 6; i++) {
			await page.mouse.move(ax + ((bx - ax) * i) / 6, ay + ((by - ay) * i) / 6);
		}
		await editor.waitForCrossBlock(true);
		for (let i = 1; i <= 6; i++) {
			await page.mouse.move(bx + ((ax - bx) * i) / 6, by + ((ay - by) * i) / 6);
		}
		await page.mouse.up();
		await editor.waitForCrossBlock(false);
	});

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

	test('rectangular intra-table drag paints overlay across the rectangle', async ({ page }) => {
		await dragBetweenCells(page, 0, 4);
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.path).toEqual(sel!.focus.path);
		expect(sel!.anchor.offset).toBe(0);
		expect(sel!.focus.offset).toBe(4);
		expect(await page.locator('.selection-overlay').count()).toBeGreaterThan(0);
	});

	test('anti-diagonal rectangular selection paints full bounding rect (regression for b840b18)', async ({
		page
	}) => {
		// Cell 2 = (row 0, col 2) — top-right; cell 6 = (row 2, col 0) — bottom-left.
		// Pre-fix returned an empty rect set; this asserts the full 3×3 bounding rect.
		await dragBetweenCells(page, 2, 6);
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.offset).toBe(2);
		expect(sel!.focus.offset).toBe(6);
		expect(await page.locator('.selection-overlay').count()).toBeGreaterThan(0);
	});
});

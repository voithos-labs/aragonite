import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { dragBetweenCells } from './helpers';

const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

// Multi-character, distinctive cells on purpose: the buggy fall-through path
// places the caret at the row-major linear index read as a CHARACTER offset into
// the table's concatenated text. With single-char cells those two coincide, so a
// regression would still land in the right cell — only multi-char cells separate
// the linear index from the char offset and make the bug observable.
const TABLE_MULTICHAR =
	'| h1 | h2 | h3 |\n| --- | --- | --- |\n| aaa | bbb | ccc |\n| ddd | eee | fff |\n';

test.describe('table block: pointer selection', () => {
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
		await page
			.locator('[role="cell"]')
			.nth(8)
			.click({ modifiers: ['Shift'] });
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

	// F3: a pointer-drag table endpoint must carry cellCoordinate:true so collapse
	// routes to the DEEP [table,row,col] cell, matching the keyboard path. Without the
	// flag, collapse lands on the table WRAPPER at a meaningless char offset and the
	// typed marker misses the cell. Multi-char cells separate the row-major linear
	// index from a char offset, making the wrong-landing observable.
	test('collapsing a pointer-dragged table selection lands the caret in the deep cell (F3)', async ({
		page
	}) => {
		await editor.loadContent('Before.\n\n' + TABLE_MULTICHAR);
		const para = page.getByText('Before.');
		const targetCell = page.locator('[role="cell"]').last(); // last body cell "fff"
		const paraBox = await para.boundingBox();
		const cellBox = await targetCell.boundingBox();
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

		await page.keyboard.press('ArrowRight'); // collapse to end (the focus cell)
		await editor.waitForCrossBlock(false);
		await editor.typeText('DEEP_MARK');
		await editor.bridge.waitForSourceContains('DEEP_MARK');

		const cells = page.locator('[role="cell"]');
		expect(await cells.last().textContent()).toContain('DEEP_MARK');
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

	test('Ctrl+Shift+End collapse-to-end lands the caret in the small table last cell', async ({
		page
	}) => {
		await editor.loadContent(TABLE_MULTICHAR);
		// The windowing-gate safety story only covered the giant (windowed) table;
		// this is the same collapse path on an unwindowed grid, where the cell-
		// coordinate branch corrects a pre-existing meaningless-offset caret bug.
		expect(await page.locator('.table-block > .vr-spacer').count()).toBe(0);

		await page.locator('[role="cell"]').nth(3).click(); // first body cell "aaa"
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ArrowRight'); // collapse to the end (last cell)
		// The collapse is async; settle before typing so the marker is a plain caret
		// insert, not a type-replace over the still-active cross-block range.
		await editor.waitForCrossBlock(false);
		await editor.typeText('END_MARK');
		await editor.bridge.waitForSourceContains('END_MARK');

		const cells = page.locator('[role="cell"]');
		expect(await cells.last().textContent()).toContain('END_MARK');
		expect(await cells.nth(4).textContent()).not.toContain('END_MARK');
	});

	// Regression: TableCellBlock ran cellKeydownPlan BEFORE cross-block dispatch,
	// so a plan-claimed key (ArrowLeft@0, ArrowUp/Down) never collapsed an active
	// cross-block selection. The next keystroke then range-replaced the whole
	// table body. ArrowRight "lucked out" (offset-gated, declined by the plan at a
	// non-end caret); ArrowLeft and ArrowDown are claimed and wiped.
	test('Ctrl+Shift+End then ArrowLeft collapses to start without wiping the table body', async ({
		page
	}) => {
		await editor.loadContent(TABLE_MULTICHAR);
		expect(await page.locator('.table-block > .vr-spacer').count()).toBe(0);

		await page.locator('[role="cell"]').nth(3).click(); // first body cell "aaa"
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ArrowLeft'); // collapse to the start (anchor cell)
		await editor.waitForCrossBlock(false);
		await editor.typeText('LEFT_MARK');
		await editor.bridge.waitForSourceContains('LEFT_MARK');

		const source = await editor.bridge.getSource();
		expect(source, `middle row wiped:\n${source}`).toContain('| eee |');
		const cells = page.locator('[role="cell"]');
		expect(await cells.nth(3).textContent()).toContain('LEFT_MARK');
	});

	test('Ctrl+Shift+End then ArrowDown collapses to end without wiping the table body', async ({
		page
	}) => {
		await editor.loadContent(TABLE_MULTICHAR);
		expect(await page.locator('.table-block > .vr-spacer').count()).toBe(0);

		await page.locator('[role="cell"]').nth(3).click(); // first body cell "aaa"
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ArrowDown'); // collapse to the end (last cell)
		await editor.waitForCrossBlock(false);
		await editor.typeText('DOWN_MARK');
		await editor.bridge.waitForSourceContains('DOWN_MARK');

		const source = await editor.bridge.getSource();
		expect(source, `middle row wiped:\n${source}`).toContain('| eee |');
		const cells = page.locator('[role="cell"]');
		expect(await cells.last().textContent()).toContain('DOWN_MARK');
	});

	// The 3-stage Ctrl+A (cell -> table -> document) must survive the cross-block-
	// first dispatch: stage 2 sets isCrossBlock, so the new gate routes stage 3
	// into the cross-block Ctrl+A handler. End state must still be whole-document.
	test('three Ctrl+A presses in a cell select the whole document', async ({ page }) => {
		await editor.loadContent('Before.\n\n' + TABLE_MULTICHAR + '\nAfter.\n');

		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('Control+a'); // stage 1: cell
		await page.keyboard.press('Control+a'); // stage 2: table (enters cross-block)
		await page.keyboard.press('Control+a'); // stage 3: whole document
		await editor.waitForCrossBlock(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.path[0]).toBe(0);
		expect(sel!.focus.path[0]).toBe(2); // last top-level block (paragraph "After.")
	});
});

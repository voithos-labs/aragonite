import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';

// Header + 1 body row, 3 columns. Cells render row-major, header first: nth 0,1,2 = header A,B,C
// and nth 3,4,5 = body 1,2,3; one grip per column, so nth(0) is column A's. Small and fully mounted
// (no row windowing), so the parity check needs no benign-row filter.
const C3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';

let editor: EditorPage;

test.beforeEach(async ({ page }) => {
	editor = new EditorPage(page);
	await editor.goto();
});

// Drag a column grip onto a destination header cell's RIGHT edge — the gap just past that column.
// Columns share track widths with no gap, so that x is the equidistant-safe drop point under the
// strict-`<` edge tiebreak.
async function dragColGripPast(page: Page, fromNth: number, toCellNth: number): Promise<void> {
	await page.hover('[role="table"]');
	const grip = await page.locator('[data-table-col-grip]').nth(fromNth).boundingBox();
	const target = await page.locator('[role="cell"]').nth(toCellNth).boundingBox();
	if (!grip || !target) throw new Error('drag-reorder-column: missing grip or target geometry');
	await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x + target.width, target.y + target.height / 2, { steps: 8 });
	await page.mouse.up();
}

test.describe('table block: mouse drag column reorder', () => {
	test('dragging column A past column B reorders (insert semantics)', async ({ page }) => {
		await editor.loadContent(C3);
		await dragColGripPast(page, 0, 1); // column-A grip → past header B
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);
	});

	// The `gap <= from` branch of the target formula — only a LEFTWARD drag hits it. Column C (grip
	// nth 2) onto header-A's right edge (gap 1) lands C before B.
	test('dragging a column left past its neighbor reorders (gap <= from branch)', async ({
		page
	}) => {
		await editor.loadContent(C3);
		await dragColGripPast(page, 2, 0);
		await editor.bridge.waitForSourceMatches(/\| A \| C \| B \|/);
	});

	// Dragging column A to the table's right edge exercises the upper clamp
	// (target = colCount - 1). Grip A onto header-C's right edge (last gap).
	test('dragging a column past the last column lands it at the end', async ({ page }) => {
		await editor.loadContent(C3);
		await dragColGripPast(page, 0, 2);
		await editor.bridge.waitForSourceMatches(/\| B \| C \| A \|/);
	});

	test('a vertical insertion line appears during the drag and clears on release', async ({
		page
	}) => {
		await editor.loadContent(C3);
		await page.hover('[role="table"]');
		const grip = await page.locator('[data-table-col-grip]').nth(0).boundingBox();
		const target = await page.locator('[role="cell"]').nth(1).boundingBox();
		if (!grip || !target) throw new Error('missing grip or target geometry');
		await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
		await page.mouse.down();
		await page.mouse.move(target.x + target.width, target.y + target.height / 2, { steps: 8 });
		await expect(page.locator('.table-reorder-line-vertical')).toBeVisible();
		await page.mouse.up();
		await expect(page.locator('.table-reorder-line-vertical')).toHaveCount(0);
	});

	test('column drag is single-undo and parity-clean (keyed permute safe)', async ({ page }) => {
		const errs: string[] = [];
		page.on('pageerror', (e) => errs.push(e.message));
		await editor.loadContent(C3);
		await dragColGripPast(page, 0, 1);
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);
		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(errs).toEqual([]);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(C3);
	});

	test('column drag → undo restores a non-canonical table byte-exactly', async ({ page }) => {
		const NONCANON = '|A|B|C|\n|---|---|---|\n|1|2|3|\n';
		await editor.loadContent(NONCANON);
		const original = await editor.bridge.getSource();
		expect(original).toContain('|1|2|3|');
		await dragColGripPast(page, 0, 1);
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);
		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(original);
	});

	// The drag starts from the grip, not a cell, so afterTick lands focus via the
	// no-focused-cell path (row 0, target column). Typing must reach that cell.
	test('after a column drag the caret is usable', async ({ page }) => {
		await editor.loadContent(C3);
		await dragColGripPast(page, 0, 1);
		await editor.bridge.waitForSourceMatches(/\| B \| A \| C \|/);
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('X');
	});

	test('a plain column-grip click (no drag) still opens the menu', async ({ page }) => {
		await editor.loadContent(C3);
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click();
		await expect(page.getByRole('menuitem', { name: /insert column right/i })).toBeVisible();
	});
});

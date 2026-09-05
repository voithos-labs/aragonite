import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';
import { capturePageErrors } from '../../../page-probes';

// Header + 3 body rows. Cells render row-major, header first; row grips are one
// per CST row, so nth(0) is the header grip and nth(1) the first body row.
const T = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';

let editor: EditorPage;

test.beforeEach(async ({ page }) => {
	editor = new EditorPage(page);
	await editor.goto();
});

// Rows are display:contents (no box), so the drop point is read from a cell, not the [role="row"]
// element; `dropY` picks the vertical landing within that cell (top vs bottom edge).
async function dragGripToCell(
	page: Page,
	gripNth: number,
	cellNth: number,
	dropY: (box: { y: number; height: number }) => number
): Promise<void> {
	await page.hover('[role="table"]');
	const grip = await page.locator('[data-table-row-grip]').nth(gripNth).boundingBox();
	const target = await page.locator('[role="cell"]').nth(cellNth).boundingBox();
	if (!grip || !target) throw new Error('drag-reorder-row: missing grip or target geometry');
	await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x + 5, dropY(target), { steps: 8 });
	await page.mouse.up();
}

// First BODY row grip (nth 1, row "1 2") dragged onto the bottom of the second
// body row (cell nth 4, row "3 4") → "1 2" lands after "3 4".
async function dragRowGripPastNext(page: Page): Promise<void> {
	await dragGripToCell(page, 1, 4, (b) => b.y + b.height - 2);
}

// Press a body-row grip, cross the move threshold, then release BACK on the same grip so a click
// still fires — the recognized-drag flag is what must suppress the menu.
async function dragGripAndReleaseOnSelf(page: Page, gripNth: number): Promise<void> {
	await page.hover('[role="table"]');
	const grip = await page.locator('[data-table-row-grip]').nth(gripNth).boundingBox();
	if (!grip) throw new Error('drag-reorder-row: missing grip geometry');
	const cx = grip.x + grip.width / 2;
	const cy = grip.y + grip.height / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	await page.mouse.move(cx, cy + 30, { steps: 8 }); // well past the 4px drag threshold
	await page.mouse.move(cx, cy, { steps: 8 });
	await page.mouse.up();
}

test.describe('table block: mouse drag row reorder', () => {
	test('dragging a body-row grip past the next row reorders (insert semantics)', async ({
		page
	}) => {
		await editor.loadContent(T);
		await dragRowGripPastNext(page);
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|[\s\S]*\| 5 \| 6 \|/);
	});

	// The `gap <= from` branch of the target formula — only an UPWARD drag hits it. Second body row
	// ("3 4", grip nth 2) dragged onto the TOP of the first body row lands before "1 2".
	test('dragging a body-row grip onto an earlier row reorders upward', async ({ page }) => {
		await editor.loadContent(T);
		await dragGripToCell(page, 2, 2, (b) => b.y + 3);
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|[\s\S]*\| 5 \| 6 \|/);
	});

	// Downward drag of a MIDDLE row to the table's end exercises the upper clamp
	// (target = rowCount - 1). "3 4" (grip nth 2) onto the bottom of the last row.
	test('dragging a middle row past the last row lands it at the end', async ({ page }) => {
		await editor.loadContent(T);
		await dragGripToCell(page, 2, 6, (b) => b.y + b.height - 2);
		await editor.bridge.waitForSourceMatches(/\| 1 \| 2 \|[\s\S]*\| 5 \| 6 \|[\s\S]*\| 3 \| 4 \|/);
	});

	test('row drag is single-undo and parity-clean', async ({ page }) => {
		const errs = capturePageErrors(page);
		await editor.loadContent(T);
		await dragRowGripPastNext(page);
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|/);
		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(errs).toEqual([]);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(T);
	});

	test('row drag → undo restores a non-canonical table byte-exactly', async ({ page }) => {
		const NONCANON = '|A|B|\n|---|---|\n|1|2|\n|3|4|\n';
		await editor.loadContent(NONCANON);
		const original = await editor.bridge.getSource();
		expect(original).toContain('|1|2|');
		await dragRowGripPastNext(page);
		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|[\s\S]*\| 1 \| 2 \|/);
		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(original);
	});

	test('after a row drag the caret is usable', async ({ page }) => {
		await editor.loadContent(T);
		await dragRowGripPastNext(page);
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('X');
	});

	test('an insertion line appears during the drag and clears on release', async ({ page }) => {
		await editor.loadContent(T);
		await page.hover('[role="table"]');
		const grip = await page.locator('[data-table-row-grip]').nth(1).boundingBox();
		const target = await page.locator('[role="cell"]').nth(4).boundingBox();
		if (!grip || !target) throw new Error('missing grip or target geometry');
		await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
		await page.mouse.down();
		await page.mouse.move(target.x + 5, target.y + target.height - 2, { steps: 8 });
		await expect(page.locator('.table-reorder-line')).toBeVisible();
		await page.mouse.up();
		await expect(page.locator('.table-reorder-line')).toHaveCount(0);
	});

	// Header row is positionally fixed: dragging its grip must not reorder and
	// must paint no line (mirrors the keyboard Alt+Arrow header no-op).
	test('dragging the header-row grip does not reorder', async ({ page }) => {
		await editor.loadContent(T);
		const before = await editor.bridge.getSource();
		await dragGripToCell(page, 0, 2, (b) => b.y + b.height - 2);
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
		await expect(page.locator('.table-reorder-line')).toHaveCount(0);
	});

	test('a plain grip click (no drag) still opens the menu', async ({ page }) => {
		await editor.loadContent(T);
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click();
		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeVisible();
	});

	test('a drag released back on the same grip does not open the menu', async ({ page }) => {
		await editor.loadContent(T);
		await dragGripAndReleaseOnSelf(page, 1);
		// The insertion line clears in the same mouseup flush a menu would mount in,
		// so once it's gone an erroneously-opened menu would already be in the DOM.
		await expect(page.locator('.table-reorder-line')).toHaveCount(0);
		await expect(page.getByRole('menu')).toHaveCount(0);
	});
});

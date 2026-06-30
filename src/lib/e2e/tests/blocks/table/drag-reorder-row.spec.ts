import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';

// Header + 3 body rows. Cells render row-major, header first; row grips are one
// per CST row, so nth(0) is the header grip and nth(1) the first body row.
const T = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';

let editor: EditorPage;

test.beforeEach(async ({ page }) => {
	editor = new EditorPage(page);
	await editor.goto();
});

// Drag the first BODY row grip down to the bottom edge of the SECOND body row.
// Rows are display:contents (no box), so the drop point is read from a cell in
// the destination row, not the [role="row"] element.
async function dragRowGripPastNext(page: Page): Promise<void> {
	await page.hover('[role="table"]');
	const grip = await page.locator('[data-table-row-grip]').nth(1).boundingBox();
	const target = await page.locator('[role="cell"]').nth(4).boundingBox();
	if (!grip || !target) throw new Error('drag-reorder-row: missing grip or target geometry');
	await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x + 5, target.y + target.height - 2, { steps: 8 });
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

	test('row drag is single-undo and parity-clean', async ({ page }) => {
		const errs: string[] = [];
		page.on('pageerror', (e) => errs.push(e.message));
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

	// Header row is positionally fixed: dragging its grip must not reorder and
	// must paint no line (mirrors the keyboard Alt+Arrow header no-op).
	test('dragging the header-row grip does not reorder', async ({ page }) => {
		await editor.loadContent(T);
		const before = await editor.bridge.getSource();
		await page.hover('[role="table"]');
		const grip = await page.locator('[data-table-row-grip]').nth(0).boundingBox();
		const target = await page.locator('[role="cell"]').nth(2).boundingBox();
		if (!grip || !target) throw new Error('missing header grip or target geometry');
		await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
		await page.mouse.down();
		await page.mouse.move(target.x + 5, target.y + target.height - 2, { steps: 8 });
		await page.mouse.up();
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
});

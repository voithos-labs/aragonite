import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const TABLE_2x3 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

async function dragBetween(
	page: Page,
	fromBox: { x: number; y: number; width: number; height: number },
	toBox: { x: number; y: number; width: number; height: number }
): Promise<void> {
	const sx = fromBox.x + fromBox.width / 2;
	const sy = fromBox.y + fromBox.height / 2;
	const ex = toBox.x + toBox.width / 2;
	const ey = toBox.y + toBox.height / 2;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	for (let i = 1; i <= 12; i++) {
		const t = i / 12;
		await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
	}
	await page.mouse.up();
}

async function boxesOf(a: ReturnType<Page['locator']>, b: ReturnType<Page['locator']>) {
	const ab = await a.boundingBox();
	const bb = await b.boundingBox();
	if (!ab || !bb) throw new Error('missing bounding box');
	return [ab, bb] as const;
}

test.describe('table block: cross-block delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Case 3 — paragraph → full-table → paragraph merges and removes the table', async ({
		page
	}) => {
		await editor.loadContent(`head text\n\n${TABLE_2x3}\ntail text\n`);
		await editor.focusBlockAtPath([0], 4);
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		await editor.bridge.waitForBlockCount(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe('head');
	});

	test('cross-block delete undo restores the original document in a single Ctrl+Z', async ({
		page
	}) => {
		const source = `head text\n\n${TABLE_2x3}\ntail text\n`;
		await editor.loadContent(source);
		await editor.focusBlockAtPath([0], 4);
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		await editor.undo();
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(source.replace(/\s+$/, ''));
	});

	test('Case 1 — paragraph above → mid-table Backspace clears prefix and promotes header', async ({
		page
	}) => {
		await editor.loadContent(`Before.\n\n${TABLE_2x3}`);
		const [paraBox, cellBox] = await boxesOf(
			page.getByText('Before.'),
			page.locator('[role="cell"]').nth(3)
		);
		await dragBetween(page, paraBox, cellBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| A | B |');
		await editor.bridge.waitForSourceContains('|  | 2 |');
		await editor.bridge.waitForSourceContains('| 3 | 4 |');
	});

	test('Case 2 — mid-table → paragraph below Backspace clears suffix', async ({ page }) => {
		await editor.loadContent(`${TABLE_2x3}\nfollow paragraph\n`);
		const [cellBox, paraBox] = await boxesOf(
			page.locator('[role="cell"]').nth(1),
			page.getByText('follow paragraph')
		);
		await dragBetween(page, cellBox, paraBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		await editor.bridge.waitForSourceContains('| A |  |');
		// Caret lands inside the cleared anchor cell (col 1), not the table wrapper
		// or the previous cell. Spec § Cross-block delete Case 2: "end of surviving
		// anchor cell content".
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('| A | Z |');
	});

	test('Case 2 — anchor at col 0 lands at end of previous-row last cell', async ({ page }) => {
		const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';
		await editor.loadContent(`${TABLE_3x3}\nfollow paragraph\n`);
		// Drag from cell (1, 0) = "1" to the paragraph below; anchorCol === 0
		// removes anchor row entirely. Survivor: end of last cell of row 0 = "C".
		const [cellBox, paraBox] = await boxesOf(
			page.locator('[role="cell"]').nth(3),
			page.getByText('follow paragraph')
		);
		await dragBetween(page, cellBox, paraBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 |');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('| A | B | CZ |');
	});

	test('whole-table Ctrl+A 2nd press + Backspace deletes the table block', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		await page.locator('[role="cell"]').nth(4).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| --- | --- | --- |');
		await expect(page.locator('[role="cell"]')).toHaveCount(0);
	});

	test('drag-select an entire row + Backspace deletes that row', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		const [fromBox, toBox] = await boxesOf(
			page.locator('[role="cell"]').nth(3),
			page.locator('[role="cell"]').nth(5)
		);
		await dragBetween(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 5 | 6 |');
		await expect(page.locator('[role="cell"]')).toHaveCount(6);
	});

	test('drag-select an entire column + Backspace deletes that column', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		const [fromBox, toBox] = await boxesOf(
			page.locator('[role="cell"]').nth(1),
			page.locator('[role="cell"]').nth(7)
		);
		await dragBetween(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('| A | C |');
		await editor.bridge.waitForSourceContains('| 1 | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 6 |');
		await expect(page.locator('[role="cell"]')).toHaveCount(6);
	});

	test('drag-select a partial cell range + Backspace clears the cells (structure preserved)', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3x3);
		const [fromBox, toBox] = await boxesOf(
			page.locator('[role="cell"]').nth(0),
			page.locator('[role="cell"]').nth(4)
		);
		await dragBetween(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('|  |  | C |');
		await editor.bridge.waitForSourceContains('|  |  | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 5 | 6 |');
		await expect(page.locator('[role="cell"]')).toHaveCount(9);
	});

	test('whole-row coverage that would leave only the header is a no-op', async ({ page }) => {
		// 2x2 table = 1 header + 1 body row; deleting the body row would violate ≥1 body row.
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const before = await editor.bridge.getSource();
		const [fromBox, toBox] = await boxesOf(
			page.locator('[role="cell"]').nth(2),
			page.locator('[role="cell"]').nth(3)
		);
		await dragBetween(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Backspace at offset 0 of first cell navigates to previous block, no delete', async ({
		page
	}) => {
		await editor.loadContent(`Before.\n\n${TABLE_2x3}`);
		const before = await editor.bridge.getSource();
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');
		expect(await editor.bridge.getSource()).toBe(before);
		const focusedPath = await page.evaluate(
			() =>
				document.activeElement?.closest('[data-block-path]')?.getAttribute('data-block-path') ??
				null
		);
		expect(focusedPath).toBe('[0]');
	});

	test('keyboard Shift+ArrowDown from a cell into the paragraph below deletes without corrupting the grid', async ({
		page
	}) => {
		await editor.loadContent(`${TABLE_2x3}\nafter\n`);
		// Anchor in the bottom-right cell, then extend into the paragraph below via
		// the keyboard table-extend path (distinct from pointer drag / Ctrl+Shift+End).
		await page.locator('[role="cell"]').nth(5).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();
		const source = await editor.bridge.getSource();
		// The table grid must stay valid: external paragraph text must never be
		// fused into a table cell. The bug produced `| 3 | 4after\n |`. The correct
		// table-aware delete clears the anchor cell and leaves "after" a paragraph.
		expect(source).toContain('| --- | --- |');
		expect(source).not.toContain('4after');
		expect(source).toContain('| 3 |  |');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});
});

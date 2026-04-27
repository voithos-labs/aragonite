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

	// Cross-block entry into a cell mid-table from outside the table doesn't
	// produce the cell-encoded selection that range-delete-table expects:
	// neither pointer drag nor shift-click resolves the cell to a shallow
	// {path: tablePath, offset: cellIdx} encoding. Tracked for 0.7 — separate
	// from the row-rebuild Gap 1 which Case 2 + whole-table cover.
	test.fixme(
		'Case 1 — paragraph above → mid-table Backspace clears prefix and promotes header',
		async ({ page }) => {
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
		}
	);

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
	});

	test('whole-table Ctrl+A 2nd press + Backspace clears every cell, preserves structure', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3x3);
		await page.locator('[role="cell"]').nth(4).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains(
			'|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |'
		);
		await expect(page.locator('[role="cell"]')).toHaveCount(9);
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
		await page.keyboard.type('!');
		await editor.bridge.waitForSourceContains('Before.!');
	});
});

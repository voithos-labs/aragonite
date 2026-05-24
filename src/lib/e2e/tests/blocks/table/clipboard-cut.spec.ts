import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const TABLE_2BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_ALIGNED = '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

async function readClipboard(page: Page): Promise<string> {
	return page.evaluate(() => navigator.clipboard.readText());
}

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

test.describe('table block: clipboard cut', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		// Reset clipboard so leakage between tests cannot mask a missing write.
		await page.evaluate(() => navigator.clipboard.writeText(''));
	});

	test('intra-cell Ctrl+X removes selected text from cell and writes it to clipboard', async ({
		page
	}) => {
		// Cell raw is "hello" — select all and cut.
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | 2 |\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('Control+x');

		await expect.poll(() => readClipboard(page)).toBe('hello');
		await editor.bridge.waitForSourceContains('|  | 2 |');
		await editor.bridge.waitForSourceNotContains('hello');
	});

	test('intra-cell Ctrl+X then Ctrl+Z restores the original cell content in one undo', async ({
		page
	}) => {
		const source = '| A | B |\n| --- | --- |\n| hello | 2 |\n';
		await editor.loadContent(source);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('Control+x');
		await editor.bridge.waitForSourceNotContains('hello');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| hello | 2 |');
	});

	test('intra-table sub-rectangle Ctrl+X writes sub-table to clipboard and clears the cells', async ({
		page
	}) => {
		await editor.loadContent(TABLE_ALIGNED);
		// 2x2 rectangle: cells 0..4 spans rows 0..1 cols 0..1 — header "A,B" + body "1,2".
		await dragBetweenCells(page, 0, 4);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Control+x');

		await expect.poll(() => readClipboard(page)).toBe('| A | B |\n| :--- | :---: |\n| 1 | 2 |\n');
		// Header row cells (A, B) and body row 1 cells (1, 2) cleared; structure preserved.
		await editor.bridge.waitForSourceContains('|  |  | C |');
		await editor.bridge.waitForSourceContains('|  |  | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 5 | 6 |');
		await expect(page.locator('[role="cell"]')).toHaveCount(9);
	});

	test('cross-block Ctrl+X originating in a cell writes the range to clipboard and clears the source', async ({
		page
	}) => {
		await editor.loadContent(`${TABLE_2BODY}\nfollow paragraph\n`);
		// Anchor inside cell "1" (row 1, col 0), extend down into the paragraph below.
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		// Drag instead of Shift+ArrowDown: cross-block entry from inside a cell
		// routes through the table's keyboard-extend path which is not the focus
		// of this test. Drag is the cleanest way to land cross-block here.
		const from = page.locator('[role="cell"]').nth(2);
		const to = page.getByText('follow paragraph');
		const fromBox = await from.boundingBox();
		const toBox = await to.boundingBox();
		if (!fromBox || !toBox) throw new Error('missing bounding box');
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
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('Control+x');

		const clip = await readClipboard(page);
		expect(clip).toContain('1');
		expect(clip).toContain('follow paragraph');

		// Per cross-block-delete Case 2: cells [startCellIdx..lastCell] cleared in row 1,
		// row 2 removed entirely, paragraph head dropped — anchor row's cells are blank.
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		await editor.bridge.waitForSourceNotContains('| 3 | 4 |');
		await editor.bridge.waitForSourceContains('| A | B |');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	test('cross-block Ctrl+X then Ctrl+Z restores the original document in one undo', async ({
		page
	}) => {
		const source = `${TABLE_2BODY}\nfollow paragraph\n`;
		await editor.loadContent(source);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		const from = page.locator('[role="cell"]').nth(2);
		const to = page.getByText('follow paragraph');
		const fromBox = await from.boundingBox();
		const toBox = await to.boundingBox();
		if (!fromBox || !toBox) throw new Error('missing bounding box');
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
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Control+x');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| 1 | 2 |');
		await editor.bridge.waitForSourceContains('follow paragraph');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(source.replace(/\s+$/, ''));
	});
});

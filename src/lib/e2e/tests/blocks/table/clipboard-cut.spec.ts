import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { boxesOf, dragBetweenBoxes, dragBetweenCells } from './helpers';

const TABLE_2BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_ALIGNED = '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

test.describe('table block: clipboard cut', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		// Reset clipboard so leakage between tests cannot mask a missing write.
		await editor.seedClipboard('');
	});

	test('intra-cell Ctrl+X removes selected text from cell and writes it to clipboard', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | 2 |\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('Control+x');

		await expect.poll(() => editor.readClipboard()).toBe('hello');
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

		await expect
			.poll(() => editor.readClipboard())
			.toBe('| A | B |\n| :--- | :---: |\n| 1 | 2 |\n');
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
		// Drag rather than Shift+ArrowDown: keyboard entry from inside a cell routes through the
		// table's keyboard-extend path, which is not what this test is about.
		const [cell, paragraph] = await boxesOf(
			page.locator('[role="cell"]').nth(2),
			page.getByText('follow paragraph')
		);
		await dragBetweenBoxes(page, cell, paragraph);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('Control+x');

		const clip = await editor.readClipboard();
		expect(clip).toContain('1');
		expect(clip).toContain('follow paragraph');

		// Per cross-block-delete Case 2: cells [startCellIdx..lastCell] cleared in row 1,
		// row 2 removed entirely, paragraph head dropped — anchor row's cells are blank.
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		await editor.bridge.waitForSourceNotContains('| 3 | 4 |');
		await editor.bridge.waitForSourceContains('| A | B |');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	test('partial-column cross-block Cut keeps clipboard and surviving cells complementary', async ({
		page
	}) => {
		// Drag from the paragraph above into a mid-row, mid-column cell (a2). Whole-row snap
		// captures rows 0..1 in full and the paired delete clears the same rows, so every body cell
		// is EITHER copied (and gone) OR surviving (and not copied). Pre-snap the copy row-rounded
		// while the delete cleared only columns, so a2/a3 were both.
		await editor.loadContent(
			'head\n\n| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n'
		);
		const [head, a2] = await boxesOf(page.getByText('head'), page.locator('[role="cell"]').nth(4));
		await dragBetweenBoxes(page, head, a2);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('Control+x');
		await editor.bridge.waitForSourceNotContains('a1');

		const clip = await editor.readClipboard();
		const surviving = await editor.bridge.getSource();
		for (const value of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']) {
			const copied = clip.includes(value);
			const survived = surviving.includes(value);
			expect(copied !== survived, `${value}: copied=${copied} survived=${survived}`).toBe(true);
		}
		// Concretely: whole rows 0..1 cut, row 2 survives.
		expect(clip).toContain('a1');
		expect(surviving).toContain('b1');
	});

	test('partial-column cross-block Cut anchored in a mid-cell keeps clipboard and surviving cells complementary', async ({
		page
	}) => {
		// Inverse of the test above: the drag STARTS in the mid-cell (a2) and exits upward, so the
		// drag-start anchor is the table endpoint. Without cellCoordinate:true there the whole-row
		// snap never fires and a2/a3 land on the clipboard AND survive.
		await editor.loadContent(
			'head\n\n| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n'
		);
		const [a2, head] = await boxesOf(
			page.locator('[role="cell"]').nth(4), // a2 (mid-column)
			page.getByText('head')
		);
		await dragBetweenBoxes(page, a2, head);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('Control+x');
		await editor.bridge.waitForSourceNotContains('a1');

		const clip = await editor.readClipboard();
		const surviving = await editor.bridge.getSource();
		for (const value of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']) {
			const copied = clip.includes(value);
			const survived = surviving.includes(value);
			expect(copied !== survived, `${value}: copied=${copied} survived=${survived}`).toBe(true);
		}
	});

	test('cross-block Ctrl+X then Ctrl+Z restores the original document in one undo', async ({
		page
	}) => {
		const original = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nfollow paragraph\n';
		await editor.loadContent(original);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		const [cell, paragraph] = await boxesOf(
			page.locator('[role="cell"]').nth(2),
			page.getByText('follow paragraph')
		);
		await dragBetweenBoxes(page, cell, paragraph);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Control+x');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| 1 | 2 |');
		await editor.bridge.waitForSourceContains('follow paragraph');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			original.replace(/\s+$/, '')
		);
	});
});

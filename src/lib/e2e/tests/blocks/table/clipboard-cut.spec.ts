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

	test('intra-cell Ctrl+X removes selected text from cell and writes it to clipboard, and one undo restores it', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | 2 |\n');
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('End');
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('ControlOrMeta+x');

		await expect.poll(() => editor.readClipboard()).toBe('hello');
		await editor.bridge.waitForSourceContains('|  | 2 |');
		await editor.bridge.waitForSourceNotContains('hello');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| hello | 2 |');
	});

	test('intra-table sub-rectangle Ctrl+X writes sub-table to clipboard and clears the cells', async ({
		page
	}) => {
		await editor.loadContent(TABLE_ALIGNED);
		// 2x2 rectangle: cells 0..4 spans rows 0..1, cols 0..1, header "A,B" plus body "1,2".
		await dragBetweenCells(page, 0, 4);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ControlOrMeta+x');

		await expect
			.poll(() => editor.readClipboard())
			.toBe('| A | B |\n| :--- | :---: |\n| 1 | 2 |\n');
		await editor.bridge.waitForSourceContains('|  |  | C |');
		await editor.bridge.waitForSourceContains('|  |  | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 5 | 6 |');
		await expect(page.locator('.table-cell')).toHaveCount(9);
	});

	// Miss-analysis: every rectangle cut here held part of a row, so a whole row or column never
	// met the cut's own removal.
	test('Ctrl+X over a whole row removes the row', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await dragBetweenCells(page, 3, 5);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ControlOrMeta+x');

		await expect.poll(() => editor.readClipboard()).toContain('| 1 | 2 | 3 |');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 5 | 6 |');
		await expect(page.locator('.table-cell')).toHaveCount(6);
	});

	test('Ctrl+X over a whole column removes the column', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await dragBetweenCells(page, 1, 7);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ControlOrMeta+x');

		await editor.bridge.waitForSourceContains('| A | C |');
		await editor.bridge.waitForSourceContains('| 1 | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 6 |');
		await expect(page.locator('.table-cell')).toHaveCount(6);
	});

	test('typing over a whole row clears its cells and types into the first', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await dragBetweenCells(page, 3, 5);
		await editor.waitForCrossBlock(true);
		await page.keyboard.type('x');

		await editor.bridge.waitForSourceContains('| x |  |  |');
		await expect(page.locator('.table-cell')).toHaveCount(9);
	});

	test('pasting over a whole row clears its cells and pastes into the first', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await editor.seedClipboard('P');
		await dragBetweenCells(page, 3, 5);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ControlOrMeta+v');

		await editor.bridge.waitForSourceContains('| P |  |  |');
		await expect(page.locator('.table-cell')).toHaveCount(9);
	});

	test('cross-block Ctrl+X originating in a cell writes the range to clipboard and clears the source, and one undo restores the document', async ({
		page
	}) => {
		const source = `${TABLE_2BODY}\nfollow paragraph\n`;
		await editor.loadContent(source);
		// Anchor inside cell "1" (row 1, col 0), extend down into the paragraph below.
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('End');
		// Drag rather than Shift+ArrowDown: keyboard entry from inside a cell routes through the
		// table's keyboard-extend path, which is not what this test is about.
		const [cell, paragraph] = await boxesOf(
			page.locator('.table-cell').nth(2),
			page.getByText('follow paragraph')
		);
		await dragBetweenBoxes(page, cell, paragraph);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+x');

		const clip = await editor.readClipboard();
		expect(clip).toContain('1');
		expect(clip).toContain('follow paragraph');

		// Cells from the start cell on are cleared in row 1, row 2 goes, the paragraph's head is
		// dropped, and the anchor row's cells are blank.
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		await editor.bridge.waitForSourceNotContains('| 3 | 4 |');
		await editor.bridge.waitForSourceContains('| A | B |');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);

		await editor.undo();
		await editor.bridge.waitForSourceContains('| 1 | 2 |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(source.replace(/\s+$/, ''));
	});

	test('partial-column cross-block Cut keeps clipboard and surviving cells complementary', async ({
		page
	}) => {
		// Dragging into mid-row cell a2 snaps to whole rows 0..1 for both copy and delete, so every
		// body cell is either copied and gone or kept and not copied.
		await editor.loadContent(
			'head\n\n| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n'
		);
		const [head, a2] = await boxesOf(page.getByText('head'), page.locator('.table-cell').nth(4));
		await dragBetweenBoxes(page, head, a2);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+x');
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
		// The reverse drag starts at a2, so the table endpoint is the drag's start; without
		// `cellCoordinate: true` there, a2 and a3 are copied and survive.
		await editor.loadContent(
			'head\n\n| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n'
		);
		const [a2, head] = await boxesOf(
			page.locator('.table-cell').nth(4), // a2 (mid-column)
			page.getByText('head')
		);
		await dragBetweenBoxes(page, a2, head);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceNotContains('a1');

		const clip = await editor.readClipboard();
		const surviving = await editor.bridge.getSource();
		for (const value of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']) {
			const copied = clip.includes(value);
			const survived = surviving.includes(value);
			expect(copied !== survived, `${value}: copied=${copied} survived=${survived}`).toBe(true);
		}
	});
});

import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { dragBetweenBoxes, dragBetweenCells } from './helpers';
import { roundTripStable } from '../../plugins/helpers';

// A cross-block range reaching into a table rewrites its CELLS. Endpoints inside a grid are cell
// indices, so every covered cell is marked whole; which cells those are is the grid's question.

const TABLE_2x3 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

test.describe('table block: cross-block format toggle', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('the whole document marks the paragraph and every cell, and one undo takes it back', async ({
		page
	}) => {
		const source = `head\n\n${TABLE_2x3}`;
		await editor.loadContent(source);
		await editor.focusBlock(0, 2);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceEquals(
			'**head**\n\n| **A** | **B** |\n| --- | --- |\n| **1** | **2** |\n| **3** | **4** |\n',
			3000
		);
		expect(await roundTripStable(page)).toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(source, 3000);
	});

	test('a drag into a body cell marks that row and the rows above it, and stops there', async ({
		page
	}) => {
		await editor.loadContent(`head\n\n${TABLE_2x3}`);
		// From the paragraph's first character into body row 1, col 1 ("2"): the whole-row snap
		// pulls the run to that row's last cell, so the row is marked whole and row 2 is untouched.
		// A measured start point rather than the text box's centre, which lands past "head" and
		// gives the paragraph an empty span.
		const start = await editor.pointForOffset([0], 0);
		const cell = await page.locator('[role="cell"]').nth(3).boundingBox();
		if (!cell) throw new Error('missing cell bounding box');
		await dragBetweenBoxes(page, { x: start.x, y: start.y, width: 0, height: 0 }, cell);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceEquals(
			'**head**\n\n| **A** | **B** |\n| --- | --- |\n| **1** | **2** |\n| 3 | 4 |\n',
			3000
		);
	});

	test('a drag between two cells marks the rectangle they span, not the run between them', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3x3);
		// Cell 4 ("2") to cell 7 ("5"): one column, two rows. A row-major run would take "3" and
		// "4" as well.
		await dragBetweenCells(page, 4, 7);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('| 1 | **2** | 3 |');
		expect(await editor.bridge.getSource()).toBe(
			'| A | B | C |\n| --- | --- | --- |\n| 1 | **2** | 3 |\n| 4 | **5** | 6 |\n'
		);
	});

	test('a keyboard extend out of the last cell marks that row and the paragraph below', async ({
		page
	}) => {
		await editor.loadContent(`${TABLE_2x3}\nafter\n`);
		await page.locator('[role="cell"]').nth(5).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		// The extend lands the focus at the paragraph's offset 0, where its head span is empty;
		// carrying on to the document end is what gives the paragraph bytes to mark.
		await page.keyboard.press('ControlOrMeta+Shift+End');

		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceEquals(
			'| A | B |\n| --- | --- |\n| 1 | 2 |\n| **3** | **4** |\n\n**after**\n',
			3000
		);
	});

	test('an empty cell keeps its bytes while the covered cells wrap, and a second press unwraps', async ({
		page
	}) => {
		const source = '| A |  |\n| --- | --- |\n| 1 |  |\n';
		await editor.loadContent(source);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceEquals('| **A** |  |\n| --- | --- |\n| **1** |  |\n', 3000);

		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceEquals(source, 3000);
	});

	test('a cell holding an escaped pipe is still one cell after the toggle', async ({ page }) => {
		await editor.loadContent('| a\\|b | c |\n| --- | --- |\n| d | e |\n');
		await dragBetweenCells(page, 0, 1);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceEquals(
			'| **a\\|b** | **c** |\n| --- | --- |\n| d | e |\n',
			3000
		);
		await expect(page.locator('[role="cell"]')).toHaveCount(4);
		expect(await roundTripStable(page)).toBe(true);
	});
});

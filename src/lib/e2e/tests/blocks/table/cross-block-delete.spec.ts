import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { boxesOf, dragBetweenBoxes, dragBetweenCells } from './helpers';
import { capturePageErrors } from '../../../page-probes';
import { roundTripStable } from '../../plugins/helpers';
import { pointAtRaw } from '../../../text-runs';

const TABLE_2x3 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

test.describe('table block: cross-block delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Case 3: paragraph → full-table → paragraph merges and removes the table', async ({
		page
	}) => {
		await editor.loadContent(`head text\n\n${TABLE_2x3}\ntail text\n`);
		await editor.focusBlockAtPath([0], 4);
		await page.keyboard.press('ControlOrMeta+Shift+End');
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
		await page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		await editor.undo();
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(source.replace(/\s+$/, ''));
	});

	test('Case 1: paragraph above → mid-table Backspace clears whole rows and promotes the survivor', async ({
		page
	}) => {
		// Whole-row snap: dragging into a body cell selects every touched row in full, so the
		// header row and row 1 go and row 2 is promoted to header, rather than cells being cleared.
		await editor.loadContent(`Before.\n\n${TABLE_2x3}`);
		const [paraBox, cellBox] = await boxesOf(
			page.getByText('Before.'),
			page.locator('.table-cell').nth(3)
		);
		await dragBetweenBoxes(page, paraBox, cellBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| A | B |');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		await editor.bridge.waitForSourceContains('| 3 | 4 |');
		// Survivor is the only row left → 2 cells.
		await expect(page.locator('.table-cell')).toHaveCount(2);
	});

	test('Case 2: mid-table → paragraph below Backspace clears whole rows', async ({ page }) => {
		// Whole-row snap: a drag starting in a body cell marks its anchor as a cell coordinate, as
		// the keyboard does, so body rows 1 and 2 go when the drag starts in row 1.
		await editor.loadContent(`${TABLE_2x3}\nfollow paragraph\n`);
		const [cellBox, paraBox] = await boxesOf(
			page.locator('.table-cell').nth(3), // body row 1, col 1 = "2"
			page.getByText('follow paragraph')
		);
		await dragBetweenBoxes(page, cellBox, paraBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		await editor.bridge.waitForSourceNotContains('| 3 | 4 |');
		// The caret must land in a real surviving cell: the subsequent keystroke writes into the
		// grid, never the table wrapper or the dropped paragraph.
		await editor.bridge.waitForSourceContains('| A | B |');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/\|[^\n|]*Z[^\n|]*\|/);
	});

	test('Case 2: anchor at col 0 lands at end of previous-row last cell', async ({ page }) => {
		const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';
		await editor.loadContent(`${TABLE_3x3}\nfollow paragraph\n`);
		// Drag from cell (1, 0) = "1" to the paragraph below; anchorCol === 0
		// removes anchor row entirely. Survivor: end of last cell of row 0 = "C".
		const [cellBox, paraBox] = await boxesOf(
			page.locator('.table-cell').nth(3),
			page.getByText('follow paragraph')
		);
		await dragBetweenBoxes(page, cellBox, paraBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 |');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('| A | B | CZ |');
	});

	test('whole-table Ctrl+A 2nd press + Backspace deletes the table block', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		await page.locator('.table-cell').nth(4).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| --- | --- | --- |');
		await expect(page.locator('.table-cell')).toHaveCount(0);
	});

	const WHOLE_TABLE_SIDES = [
		{ key: 'Backspace', lands: 'at the end of the block above', typed: 'abovex\n\nbelow\n' },
		{ key: 'Delete', lands: 'at the start of the block below', typed: 'above\n\nxbelow\n' }
	];
	for (const { key, lands, typed } of WHOLE_TABLE_SIDES) {
		test(`a whole-table ${key} puts the caret ${lands}`, async ({ page }) => {
			await editor.loadContent(`above\n\n${TABLE_3x3}\nbelow\n`);
			// Every cell, first to last: a second Ctrl+A would take the paragraphs too.
			const [fromBox, toBox] = await boxesOf(
				page.locator('.table-cell').nth(0),
				page.locator('.table-cell').nth(8)
			);
			await dragBetweenBoxes(page, fromBox, toBox);
			await editor.waitForCrossBlock(true);
			await page.keyboard.press(key);
			await editor.bridge.waitForSourceEquals('above\n\nbelow\n');

			await page.keyboard.type('x');
			await editor.bridge.waitForSourceEquals(typed);
		});
	}

	test('emptying a single-table doc leaves one editable block the user can type into', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3x3);
		await page.locator('.table-cell').nth(4).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| --- | --- | --- |');

		const childCount = await page.evaluate(
			() => (window as any).__test.getDocument().children.length as number
		);
		expect(childCount).toBeGreaterThanOrEqual(1);

		await page.keyboard.type('typed after empty');
		await editor.bridge.waitForSourceContains('typed after empty');
	});

	test('emptying a single-table doc keeps the delete in one undo entry', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		await page.locator('.table-cell').nth(4).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| --- | --- | --- |');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| --- | --- | --- |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			TABLE_3x3.replace(/\s+$/, '')
		);
	});

	test('drag-select an entire row + Backspace deletes that row', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		const [fromBox, toBox] = await boxesOf(
			page.locator('.table-cell').nth(3),
			page.locator('.table-cell').nth(5)
		);
		await dragBetweenBoxes(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 5 | 6 |');
		await expect(page.locator('.table-cell')).toHaveCount(6);
	});

	test('drag-select an entire column + Backspace deletes that column', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		const [fromBox, toBox] = await boxesOf(
			page.locator('.table-cell').nth(1),
			page.locator('.table-cell').nth(7)
		);
		await dragBetweenBoxes(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('| A | C |');
		await editor.bridge.waitForSourceContains('| 1 | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 6 |');
		await expect(page.locator('.table-cell')).toHaveCount(6);
	});

	test('drag-select a partial cell range + Backspace clears the cells (structure preserved)', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3x3);
		const [fromBox, toBox] = await boxesOf(
			page.locator('.table-cell').nth(0),
			page.locator('.table-cell').nth(4)
		);
		await dragBetweenBoxes(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('|  |  | C |');
		await editor.bridge.waitForSourceContains('|  |  | 3 |');
		await editor.bridge.waitForSourceContains('| 4 | 5 | 6 |');
		await expect(page.locator('.table-cell')).toHaveCount(9);
	});

	test('whole-row coverage that would leave only the header is a no-op', async ({ page }) => {
		// 2x2 table = 1 header + 1 body row; deleting the body row would violate ≥1 body row.
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const before = await editor.bridge.getSource();
		const [fromBox, toBox] = await boxesOf(
			page.locator('.table-cell').nth(2),
			page.locator('.table-cell').nth(3)
		);
		await dragBetweenBoxes(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);
		await editor.pressDeclined('Backspace');
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Backspace at offset 0 of first cell navigates to previous block, no delete', async ({
		page
	}) => {
		await editor.loadContent(`Before.\n\n${TABLE_2x3}`);
		const before = await editor.bridge.getSource();
		await page.locator('.table-cell').nth(0).click();
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
		await page.locator('.table-cell').nth(5).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressDeclined('Backspace');
		const source = await editor.bridge.getSource();
		// Paragraph text must never fuse into a cell as `| 3 | 4after |`: the snap removes the
		// anchor's whole bottom row and "after" stays a paragraph.
		expect(source).toContain('| --- | --- |');
		expect(source).not.toContain('4after');
		expect(source).not.toContain('| 3 |');
		expect(source).toContain('| 1 | 2 |');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});

	test('typing over a selection spanning two separate tables lands in a surviving cell, no grid corruption', async ({
		page
	}) => {
		// Two adjacent tables, both endpoints cell coordinates: the snap removes the touched rows
		// in both, and typing over the range lands in a surviving cell.
		await editor.loadContent(`${TABLE_2x3}\n${TABLE_2x3}`);
		const cells = page.locator('.table-cell');
		// Anchor in the first table's body cell "2" (idx 3), focus in the second's header cell "B"
		// (idx 7), which must read as a cell coordinate or the snap clears the wrong cell.
		const [fromBox, toBox] = await boxesOf(cells.nth(3), cells.nth(7));
		await dragBetweenBoxes(page, fromBox, toBox);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('Z');
		await editor.bridge.waitForSourceContains('Z');
		const src = await editor.bridge.getSource();
		// Z sits inside a single table cell (between two pipes on one row), never
		// fused into the grid delimiters.
		expect(src).toMatch(/\|[^\n|]*Z[^\n|]*\|/);
		// The second table's surviving rows are whole rows: no half-cleared row with an
		// empty leading cell, which only a focus at the wrong offset produces.
		expect(src).toContain('| 1 | 2 |');
		expect(src).not.toMatch(/\|\s+\|\s*2\s*\|/);
		expect(src).toContain('| --- | --- |');
	});

	test('Case 2 into a nested prose end (blockquote paragraph) truncates the tail without erroring', async ({
		page
	}) => {
		// A blockquote endpoint routes the delete through the cross-container commit on the live
		// `$state` document, whose proxied tail a lookup by node identity would miss.
		const pageErrors = capturePageErrors(page);

		const source = `${TABLE_2x3}\n> quoted text\n`;
		await editor.loadContent(source);
		await page.evaluate(() => (window as any).__test.startErrorCapture());

		const cellBox = await page.locator('.table-cell').nth(3).boundingBox(); // body "2"
		if (!cellBox) throw new Error('missing cell bounding box');
		// Nested prose endpoint: the paragraph inside the blockquote at [1, 0].
		const endPoint = await pointAtRaw(editor.page, [1, 0], 3);
		await dragBetweenBoxes(page, cellBox, { x: endPoint.x, y: endPoint.y, width: 0, height: 0 });
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		// A fixed wait: success changes the source, while the survivor-lookup throw aborts the
		// commit and fires `pageerror`; either happens well under 250ms.
		await page.waitForTimeout(250);

		const capturedErrors: string[] = await page.evaluate(() =>
			(window as any).__test.getCapturedErrors()
		);
		expect(pageErrors, `page errors during nested-end delete:\n${pageErrors.join('\n')}`).toEqual(
			[]
		);
		expect(capturedErrors, `editor errors:\n${capturedErrors.join('\n')}`).toEqual([]);

		// Whole-row snap removed both body rows, leaving the surviving header table;
		// the blockquote keeps its tail as its own block, with no cross-block merge.
		const src = await editor.bridge.getSource();
		expect(src).toContain('| A | B |');
		expect(src).toContain('| --- | --- |');
		expect(src).not.toContain('| 1 | 2 |');
		expect(src).not.toContain('| 3 | 4 |');
		expect(src).toMatch(/^>.*text/m);
		expect(await roundTripStable(page)).toBe(true);
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(1)).toBe('blockquote');

		await editor.undo();
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(source.replace(/\s+$/, ''));
	});
});

test.describe('table block: coverage delete inside a container', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const lines = (text: string) => text.trimEnd().split('\n');
	const WRAPPERS: Record<string, (table: string) => string> = {
		quote: (t) =>
			lines(t)
				.map((l) => `> ${l}\n`)
				.join(''),
		'list item': (t) =>
			lines(t)
				.map((l, i) => `${i === 0 ? '-' : ' '} ${l}\n`)
				.join('')
	};
	const ROW_GONE = '| A | B | C |\n| --- | --- | --- |\n| 4 | 5 | 6 |\n';
	const COLUMN_GONE = '| A | C |\n| --- | --- |\n| 1 | 3 |\n| 4 | 6 |\n';

	for (const [where, wrap] of Object.entries(WRAPPERS)) {
		test(`a whole row of a table in a ${where}: Backspace deletes the row`, async ({ page }) => {
			await editor.loadContent(wrap(TABLE_3x3) + '\nafter\n');
			await dragBetweenCells(page, 3, 5);
			await editor.waitForCrossBlock(true);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(wrap(ROW_GONE) + '\nafter\n');
		});

		test(`a whole column of a table in a ${where}: Backspace deletes the column`, async ({
			page
		}) => {
			await editor.loadContent(wrap(TABLE_3x3) + '\nafter\n');
			await dragBetweenCells(page, 1, 7);
			await editor.waitForCrossBlock(true);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(wrap(COLUMN_GONE) + '\nafter\n');
		});

		test(`a whole table in a ${where}: Backspace removes it and the emptied ${where}`, async ({
			page
		}) => {
			const source = wrap(TABLE_3x3) + '\nafter\n';
			await editor.loadContent(source);
			await dragBetweenCells(page, 0, 8);
			await editor.waitForCrossBlock(true);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals('after\n');

			await editor.undo();
			await editor.bridge.waitForSourceEquals(source);
		});
	}
});

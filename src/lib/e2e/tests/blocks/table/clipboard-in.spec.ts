import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { dragBetweenCells } from './helpers';

const TABLE_2BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table block: paste in', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.seedClipboard('');
	});

	// ── Structural ──────────────────────────────────────────────────────
	// A grid is data for the cells, not a block to splice between them: a GFM table, or the tabs a
	// spreadsheet writes, fills from the caret's cell and grows the table to fit, in one commit.
	test('pasting a markdown table fills cells from the caret and grows the table', async ({
		page
	}) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('.table-cell').nth(2).click();
		await editor.seedClipboard('| X | Y |\n| --- | --- |\n| 9 | 8 |\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| 9 | 8 |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['| A | B |', '| --- | --- |', '| X | Y |', '| 9 | 8 |'].join('\n')
		);
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('pasting tab-separated rows appends the rows and columns they need', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('.table-cell').nth(5).click(); // "4": row 2, col 1
		await editor.seedClipboard('p\tq\tr\ns\tt\tu\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| s | t | u |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			[
				'| A | B |  |  |',
				'| --- | --- | --- | --- |',
				'| 1 | 2 |  |  |',
				'| 3 | p | q | r |',
				'|  | s | t | u |'
			].join('\n')
		);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(TABLE_2BODY, 3000);
	});

	// An expanding paste writes cell raws two levels down; copying only the rows first leaves the
	// cells shared with the undo snapshot, so undo restores the pasted text.
	test('undo of an expanding paste restores the rendered cells, not just the bytes', async ({
		page
	}) => {
		const grid = () =>
			page.evaluate(() =>
				[...document.querySelectorAll('.table-row')]
					.map((row) =>
						[...row.querySelectorAll('.table-cell, [role="columnheader"]')]
							.map((cell) => cell.textContent?.trim() ?? '')
							.join('|')
					)
					.join(' // ')
			);

		await editor.loadContent(TABLE_2BODY);
		const before = await grid();

		await page.locator('.table-cell').nth(2).click(); // "1": row 1, col 0
		await editor.seedClipboard('p\tq\tr\ns\tt\tu\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| s | t | u |');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TABLE_2BODY, 3000);
		await expect.poll(grid).toBe(before);
	});

	// Each step pastes into a different row; the exact source is asserted because a splice through
	// a cell's row-level `blockEdit` keeps the substrings while the structure rots.
	test('pasting blocks into a cell breaks the table around them', async ({ page }) => {
		const paste = async (cell: number, text: string, waitFor: string) => {
			await editor.loadContent(TABLE_2BODY);
			await page.locator('.table-cell').nth(cell).click();
			await editor.seedClipboard(text);
			await editor.paste();
			await editor.bridge.waitForSourceContains(waitFor);
			return (await editor.bridge.getSource()).replace(/\s+$/, '');
		};

		await test.step('a heading breaks the table at the paste row', async () => {
			expect(await paste(2, '# Hello\n', '# Hello')).toBe(
				[
					'| A | B |',
					'| --- | --- |',
					'| 1 | 2 |',
					'',
					'# Hello',
					'',
					'| 3 | 4 |',
					'| --- | --- |'
				].join('\n')
			);
		});

		await test.step('a multi-block clipboard inserts every block between the halves', async () => {
			expect(await paste(2, 'Para one.\n\n## Two\n', '## Two')).toBe(
				[
					'| A | B |',
					'| --- | --- |',
					'| 1 | 2 |',
					'',
					'Para one.',
					'',
					'## Two',
					'',
					'| 3 | 4 |',
					'| --- | --- |'
				].join('\n')
			);
		});

		await test.step('a paste at row 0 leaves a header-only first half before the pasted blocks', async () => {
			expect(await paste(0, '# Sandwiched\n', '# Sandwiched')).toBe(
				[
					'| A | B |',
					'| --- | --- |',
					'',
					'# Sandwiched',
					'',
					'| 1 | 2 |',
					'| --- | --- |',
					'| 3 | 4 |'
				].join('\n')
			);
		});

		await test.step('a paste at the last row appends the blocks after the original', async () => {
			expect(await paste(4, '# Tail\n', '# Tail')).toBe(
				['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |', '', '# Tail'].join('\n')
			);
		});
	});

	// ── Undo ────────────────────────────────────────────────────────────

	test('Ctrl+Z undoes a paste in a single press', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		const before = await editor.bridge.getSource();
		await page.locator('.table-cell').nth(0).click();
		await page.keyboard.press('End');
		await editor.seedClipboard('xyz');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| Axyz | B |');
		await editor.undo();
		await editor.bridge.waitForSourceNotContains('Axyz');
		expect(await editor.bridge.getSource()).toBe(before);
	});

	// ── Multi-cell selection at paste ───────────────────────────────────

	test('sub-rectangle selection + paste clears the rect and inserts text in the anchor cell', async ({
		page
	}) => {
		await editor.loadContent(TABLE_2BODY);
		// Drag from cell 2 (row 1, col 0 = "1") to cell 5 (row 2, col 1 = "4").
		await dragBetweenCells(page, 2, 5);
		await editor.waitForCrossBlock(true);

		await editor.seedClipboard('hello');
		await editor.paste();

		// "hello" in the anchor cell is the only shape the document lacks before the paste, so it
		// is the one predicate that can resolve on it.
		await editor.bridge.waitForSourceContains('| hello |  |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['| A | B |', '| --- | --- |', '| hello |  |', '|  |  |'].join('\n')
		);
	});

	// A spreadsheet tiles a smaller grid over a selection whose sides are multiples of it.
	test('sub-rectangle selection + paste a grid tiles it over the rectangle', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await dragBetweenCells(page, 2, 5);
		await editor.waitForCrossBlock(true);

		await editor.seedClipboard('x\ty');
		await editor.paste();

		await editor.bridge.waitForSourceContains('| x | y |\n| x | y |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['| A | B |', '| --- | --- |', '| x | y |', '| x | y |'].join('\n')
		);
	});

	// Ctrl+A steps from cell to document, so a rectangle over every cell is the way to select the
	// whole table: cells 0..5 of a two-column, two-body-row table.
	test('whole-table selection (a rectangle over every cell) + paste a paragraph replaces the table', async ({
		page
	}) => {
		const source = `before\n\n${TABLE_2BODY}\nafter\n`;
		await editor.loadContent(source);
		await dragBetweenCells(page, 0, 5);
		await editor.waitForCrossBlock(true);

		await editor.seedClipboard('replaced text\n');
		await editor.paste();

		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		await editor.bridge.waitForSourceContains('replaced text');
		await editor.bridge.waitForSourceContains('before');
		await editor.bridge.waitForSourceContains('after');
	});

	test('whole-table paste is a single-undo-entry operation', async ({ page }) => {
		const source = `before\n\n${TABLE_2BODY}\nafter\n`;
		await editor.loadContent(source);
		await dragBetweenCells(page, 0, 5);
		await editor.waitForCrossBlock(true);

		await editor.seedClipboard('replaced text\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('replaced text');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| --- | --- |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(source.replace(/\s+$/, ''));
	});

	// The undo restores the cell rectangle and the redo swaps the paragraph back under it, where a
	// stale rectangle would put a cell index on a paragraph.
	test('undo and redo of a whole-table paste restore each side without a stale rectangle', async ({
		page
	}) => {
		await editor.loadContent(TABLE_2BODY);
		await dragBetweenCells(page, 0, 5);
		await editor.waitForCrossBlock(true);
		await editor.seedClipboard('replaced text\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('replaced text');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| --- | --- |');
		expect(await editor.bridge.getSource()).toBe(TABLE_2BODY);
		expect(await editor.bridge.getSelection()).toEqual({
			anchor: { path: [0], offset: 0, cellCoordinate: true },
			focus: { path: [0], offset: 5, cellCoordinate: true }
		});

		await editor.redo();
		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		expect(await editor.bridge.getSource()).toBe('replaced text\n');
		await editor.waitForCrossBlock(false);
	});
});

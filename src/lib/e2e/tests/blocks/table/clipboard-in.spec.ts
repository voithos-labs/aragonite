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

	// ── Inline ──────────────────────────────────────────────────────────

	test('plain text without special chars inserts at caret', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('End');
		await editor.seedClipboard('hello');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| Ahello | B |');
	});

	test('pipes auto-escape to backslash-pipe in cell raw', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		await editor.seedClipboard('a|b|c');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| 1a\\|b\\|c | 2 |');
	});

	test('newlines collapse to a single space and edges are trimmed', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('Home');
		// One content paragraph: the blank lines the copy wrapped around it are packaging, so the
		// cell keeps the inline path rather than breaking the table around them.
		await editor.seedClipboard('  \nhello\nworld\n  ');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| 1 | hello world2 |');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	// ── Structural ──────────────────────────────────────────────────────
	//
	// Exact-source assertions are load-bearing here: the bug they catch (a doc-level splice routed
	// through the cell's row-level blockEdit) leaves the substrings a `waitForSourceContains`
	// checks intact while the surrounding structure rots.

	test('pasting a markdown table breaks and splices around the paste row', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await editor.seedClipboard('| X | Y |\n| --- | --- |\n| 9 | 8 |\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| X | Y |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			[
				'| A | B |',
				'| --- | --- |',
				'| 1 | 2 |',
				'| X | Y |',
				'| --- | --- |',
				'| 9 | 8 |',
				'| 3 | 4 |',
				'| --- | --- |'
			].join('\n')
		);
	});

	test('pasting a heading breaks the table at the paste row', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await editor.seedClipboard('# Hello\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('# Hello');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['| A | B |', '| --- | --- |', '| 1 | 2 |', '# Hello', '| 3 | 4 |', '| --- | --- |'].join(
				'\n'
			)
		);
	});

	test('pasting a multi-block clipboard inserts every block between the halves', async ({
		page
	}) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await editor.seedClipboard('Para one.\n\n## Two\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('## Two');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			[
				'| A | B |',
				'| --- | --- |',
				'| 1 | 2 |',
				'Para one.',
				'',
				'## Two',
				'| 3 | 4 |',
				'| --- | --- |'
			].join('\n')
		);
	});

	// ── Edges ───────────────────────────────────────────────────────────

	test('paste at row 0 leaves a header-only first half before the pasted blocks', async ({
		page
	}) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(0).click();
		await editor.seedClipboard('# Sandwiched\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('# Sandwiched');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			[
				'| A | B |',
				'| --- | --- |',
				'# Sandwiched',
				'| 1 | 2 |',
				'| --- | --- |',
				'| 3 | 4 |'
			].join('\n')
		);
	});

	test('paste at the last row appends pasted blocks after the original (no second half)', async ({
		page
	}) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(4).click();
		await editor.seedClipboard('# Tail\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('# Tail');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |', '# Tail'].join('\n')
		);
	});

	// ── Undo ────────────────────────────────────────────────────────────

	test('Ctrl+Z undoes a paste in a single press', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		const before = await editor.bridge.getSource();
		await page.locator('[role="cell"]').nth(0).click();
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

		// "hello" in the anchor cell is the only shape the pre-paste document does not
		// already have, so it is the one predicate that can settle on the paste.
		await editor.bridge.waitForSourceContains('| hello |  |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['| A | B |', '| --- | --- |', '| hello |  |', '|  |  |'].join('\n')
		);
	});

	test('whole-table selection (Ctrl+A 2nd) + paste a paragraph replaces the table', async ({
		page
	}) => {
		const source = `before\n\n${TABLE_2BODY}\nafter\n`;
		await editor.loadContent(source);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
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
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		await editor.seedClipboard('replaced text\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('replaced text');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| --- | --- |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(source.replace(/\s+$/, ''));
	});
});

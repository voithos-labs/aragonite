import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const TABLE_2BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table block: paste in', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await page.evaluate(() => navigator.clipboard.writeText(''));
	});

	// ── Inline ──────────────────────────────────────────────────────────

	test('plain text without special chars inserts at caret', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('End');
		await page.evaluate(() => navigator.clipboard.writeText('hello'));
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('| Ahello | B |');
	});

	test('pipes auto-escape to backslash-pipe in cell raw', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		await page.evaluate(() => navigator.clipboard.writeText('a|b|c'));
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('| 1a\\|b\\|c | 2 |');
	});

	test('newlines collapse to a single space and edges are trimmed', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('Home');
		// Single-paragraph clipboard (no blank-line separator) keeps the inline path.
		await page.evaluate(() => navigator.clipboard.writeText('  \nhello\nworld\n  '));
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('| 1 | hello world2 |');
	});

	// ── Structural ──────────────────────────────────────────────────────
	//
	// Exact-source assertions are load-bearing here: the bug they catch (a doc-level splice routed
	// through the cell's row-level blockEdit) leaves the substrings a `waitForSourceContains`
	// checks intact while the surrounding structure rots.

	test('pasting a markdown table breaks and splices around the paste row', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await page.evaluate(() =>
			navigator.clipboard.writeText('| X | Y |\n| --- | --- |\n| 9 | 8 |\n')
		);
		await page.keyboard.press('Control+v');
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
		await page.evaluate(() => navigator.clipboard.writeText('# Hello\n'));
		await page.keyboard.press('Control+v');
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
		await page.evaluate(() => navigator.clipboard.writeText('Para one.\n\n## Two\n'));
		await page.keyboard.press('Control+v');
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
		await page.evaluate(() => navigator.clipboard.writeText('# Sandwiched\n'));
		await page.keyboard.press('Control+v');
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
		await page.evaluate(() => navigator.clipboard.writeText('# Tail\n'));
		await page.keyboard.press('Control+v');
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
		await page.evaluate(() => navigator.clipboard.writeText('xyz'));
		await page.keyboard.press('Control+v');
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
		const from = page.locator('[role="cell"]').nth(2);
		const to = page.locator('[role="cell"]').nth(5);
		const fromBox = await from.boundingBox();
		const toBox = await to.boundingBox();
		if (!fromBox || !toBox) throw new Error('missing bounding boxes');
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
		await editor.waitForCrossBlock(true);

		await page.evaluate(() => navigator.clipboard.writeText('hello'));
		await page.keyboard.press('Control+v');

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
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		await page.evaluate(() => navigator.clipboard.writeText('replaced text\n'));
		await page.keyboard.press('Control+v');

		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		await editor.bridge.waitForSourceContains('replaced text');
		await editor.bridge.waitForSourceContains('before');
		await editor.bridge.waitForSourceContains('after');
	});

	test('whole-table paste is a single-undo-entry operation', async ({ page }) => {
		const source = `before\n\n${TABLE_2BODY}\nafter\n`;
		await editor.loadContent(source);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		await page.evaluate(() => navigator.clipboard.writeText('replaced text\n'));
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('replaced text');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| --- | --- |');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(source.replace(/\s+$/, ''));
	});
});

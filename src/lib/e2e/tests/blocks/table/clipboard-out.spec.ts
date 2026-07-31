import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { dragBetweenCells, readClipboard } from './helpers';

const TABLE_ALIGNED = '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

test.describe('table block: clipboard out', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		// Reset the clipboard so leakage from one test cannot mask another's missing copy.
		await page.evaluate(() => navigator.clipboard.writeText(''));
	});

	test('Ctrl+A inside a cell + Ctrl+C copies the cell text', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+c');
		await expect.poll(() => readClipboard(page)).toBe('1');
	});

	// Copy and Cut must write the same payload: a cell's <br> renders as a zero-textContent widget,
	// so Copy's old browser-default fallback dropped it while Cut's raw-slice arm kept it.
	test('Ctrl+C of a cell with a <br> keeps the widget bytes (Copy/Cut parity)', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| a<br>b | world |\n');
		await page.locator('[role="cell"]').nth(2).click(); // "a<br>b"
		await page.keyboard.press('Control+a'); // stage-1 select-all selects the cell content
		await page.keyboard.press('Control+c');
		// Before the fix the browser default copied rendered textContent ("ab").
		await expect.poll(() => readClipboard(page)).toBe('a<br>b');
	});

	test('Ctrl+A in an empty cell copies an empty string', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n|  | 2 |\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+c');
		await expect.poll(() => readClipboard(page)).toBe('');
	});

	test('cross-block para → table → para Ctrl+C copies surrounding text + table raw', async ({
		page
	}) => {
		await editor.loadContent('Before.\n\n| A | B |\n| :--- | :---: |\n| 1 | 2 |\n\nAfter.\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Control+c');
		await expect.poll(() => readClipboard(page)).toContain('Before.');
		const clip = await readClipboard(page);
		expect(clip).toContain('| A | B |');
		expect(clip).toContain('| :--- | :---: |');
		expect(clip).toContain('| 1 | 2 |');
		expect(clip).toContain('After.');
	});

	test('2x2 rectangular drag -> Ctrl+C produces valid GFM sub-table', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await dragBetweenCells(page, 0, 4);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Control+c');
		await expect.poll(() => readClipboard(page)).toBe('| A | B |\n| :--- | :---: |\n| 1 | 2 |\n');
	});

	test('row-only rectangle copies a header-only sub-table', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await dragBetweenCells(page, 0, 2);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Control+c');
		await expect.poll(() => readClipboard(page)).toBe('| A | B | C |\n| :--- | :---: | ---: |\n');
	});

	test('sub-table inherits sliced source alignments (right-edge slice)', async ({ page }) => {
		// Source delimiter: `| :--- | :---: | ---: |`. Cells 1..5 select cols 1..2,
		// so the slice keeps the right-aligned column and drops the left-aligned one.
		await editor.loadContent(TABLE_ALIGNED);
		await dragBetweenCells(page, 1, 5);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Control+c');
		const clip = await readClipboard(page);
		expect(clip).toContain('| :---: | ---: |');
		expect(clip).not.toContain(':---|');
		expect(clip).not.toContain(':--- |');
	});

	test('whole table copy after Ctrl+A 2nd press emits table raw', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Control+c');
		await expect.poll(() => readClipboard(page)).toBe(TABLE_ALIGNED);
	});
});

import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { dragBetweenCells } from './helpers';

const TABLE_ALIGNED = '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

test.describe('table block: clipboard out', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		// Reset the clipboard so leakage from one test cannot mask another's missing copy.
		await editor.seedClipboard('');
	});

	test('Ctrl+A inside a cell + Ctrl+C copies the cell text', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await page.locator('.table-cell').nth(3).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+c');
		await expect.poll(() => editor.readClipboard()).toBe('1');
	});

	// Copy and Cut must write the same payload: a cell's `<br>` renders as a widget with no
	// textContent, so falling back to the browser's default drops it where a raw slice keeps it.
	test('Ctrl+C of a cell with a <br> keeps the widget bytes (Copy/Cut parity)', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| a<br>b | world |\n');
		await page.locator('.table-cell').nth(2).click(); // "a<br>b"
		await page.keyboard.press('ControlOrMeta+a'); // stage-1 select-all selects the cell content
		await page.keyboard.press('ControlOrMeta+c');
		// The browser default would copy rendered textContent ("ab"), losing the `<br>` source.
		await expect.poll(() => editor.readClipboard()).toBe('a<br>b');
	});

	test('Ctrl+A in an empty cell copies an empty string', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n|  | 2 |\n');
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+c');
		await expect.poll(() => editor.readClipboard()).toBe('');
	});

	test('cross-block para → table → para Ctrl+C copies surrounding text + table raw', async ({
		page
	}) => {
		await editor.loadContent('Before.\n\n| A | B |\n| :--- | :---: |\n| 1 | 2 |\n\nAfter.\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ControlOrMeta+c');
		await expect.poll(() => editor.readClipboard()).toContain('Before.');
		const clip = await editor.readClipboard();
		expect(clip).toContain('| A | B |');
		expect(clip).toContain('| :--- | :---: |');
		expect(clip).toContain('| 1 | 2 |');
		expect(clip).toContain('After.');
	});

	test('2x2 rectangular drag -> Ctrl+C produces valid GFM sub-table', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await dragBetweenCells(page, 0, 4);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ControlOrMeta+c');
		await expect
			.poll(() => editor.readClipboard())
			.toBe('| A | B |\n| :--- | :---: |\n| 1 | 2 |\n');
	});

	test('whole table copy after Ctrl+A 2nd press emits table raw', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await page.locator('.table-cell').nth(3).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ControlOrMeta+c');
		await expect.poll(() => editor.readClipboard()).toBe(TABLE_ALIGNED);
	});
	// The spreadsheet format rides beside the GFM: the same rectangle as a `<table>` on text/html.
	test('a rectangle copy also writes an HTML table for spreadsheets', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		await dragBetweenCells(page, 2, 5);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ControlOrMeta+c');
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const items = await navigator.clipboard.read();
					for (const item of items) {
						if (!item.types.includes('text/html')) continue;
						return (await item.getType('text/html')).text();
					}
					return null;
				})
			)
			.toContain('<tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr>');
	});

	// Scrolled far enough that windowing takes the table out of the page, the focused cell goes
	// with it, so Ctrl+C lands on the page body and the editor root copies.
	test('a rectangle copied with the table scrolled away copies the rectangle, text and HTML', async ({
		page
	}) => {
		const filler = Array.from({ length: 300 }, (_, i) => `para ${i}`).join('\n\n');
		await editor.loadContent(`${TABLE_ALIGNED}\n${filler}\n`);
		await dragBetweenCells(page, 1, 4);
		await editor.waitForCrossBlock(true);
		const scrollHeight = await page.evaluate(
			() => (document.querySelector('.editor') as HTMLElement).scrollHeight
		);
		await editor.scrollEditorTo(scrollHeight);
		await expect(page.locator('.table-block')).toHaveCount(0);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+c');
		await expect.poll(() => editor.readClipboard()).toBe('| B |\n| :---: |\n| 2 |\n');
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const items = await navigator.clipboard.read();
					for (const item of items) {
						if (!item.types.includes('text/html')) continue;
						return (await item.getType('text/html')).text();
					}
					return null;
				})
			)
			.toContain('<tr><td>B</td></tr><tr><td>2</td></tr>');
	});
});

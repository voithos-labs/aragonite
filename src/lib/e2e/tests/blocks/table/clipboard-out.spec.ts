import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const TABLE_ALIGNED =
	'| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

async function readClipboard(page: Page): Promise<string> {
	return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('table block: clipboard out', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		// Reset clipboard between tests so leakage from one test cannot mask
		// another's missing copy.
		await page.evaluate(() => navigator.clipboard.writeText(''));
	});

	test('Ctrl+A inside a cell + Ctrl+C copies the cell text', async ({ page }) => {
		await editor.loadContent(TABLE_ALIGNED);
		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+c');
		await expect.poll(() => readClipboard(page)).toBe('1');
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

	test.fixme(
		'2×2 rectangular drag → Ctrl+C produces valid GFM sub-table',
		async () => {
			// Plan 4 wires the input mechanism that produces path-equal anchor/focus
			// on the table with cell-index offsets, the precondition that
			// TableCellBlock.onCopy needs to pick the rectangular sub-table branch.
			// Expected output for cells (0,0)..(1,1) from TABLE_ALIGNED:
			//   '| A | B |\n| :--- | :---: |\n| 1 | 2 |\n'
		}
	);

	test.fixme(
		'row-only rectangle copies a header-only sub-table',
		async () => {
			// Plan 4 dependency. Single-row rect over cols 0..2 of TABLE_ALIGNED
			// must produce '| A | B | C |\n| :--- | :---: | ---: |\n' with no body.
		}
	);

	test.fixme(
		'sub-table inherits sliced source alignments',
		async () => {
			// Plan 4 dependency. Cols 0..1 of `| :--- | :---: | ---: |` slice to
			// `| :--- | :---: |` in the copied sub-table delimiter row.
		}
	);

	test.fixme(
		'whole table copy after Ctrl+A 2nd press emits table raw',
		async () => {
			// Plan 4 (keyboard vocabulary) implements Ctrl+A 2nd-press whole-table.
			// Expected clipboard: '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n'.
		}
	);
});

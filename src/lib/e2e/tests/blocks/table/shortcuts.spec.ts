import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';
import { capturePageErrors } from '../../../page-probes';

const TABLE_2x2 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
const TABLE_3ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

// Every column carries a distinct alignment, so a delete-column that drops the wrong delimiter cell
// shows in the source. The delete-column steps wait on whole documents: '| A | B | C | D |'
// contains '| B | C | D |', so a substring wait would pass before the delete.
const TABLE_ALIGNED = '| A | B | C | D |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n';
const TABLE_ALIGNED_LESS_A = '| B | C | D |\n| :---: | ---: | --- |\n| 2 | 3 | 4 |\n';

test.describe('table block: keyboard vocabulary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('delete-column then undo restores the rendered alignments, and column ops keep working across cycles', async ({
		page
	}) => {
		// Undo deep-clones the tree, so the state registry keyed by node identity must follow it, and
		// each undo must restore a row's `childIds` with its `children`.
		const pageErrors = capturePageErrors(page);
		await editor.loadContent(TABLE_ALIGNED);
		const captureCellAligns = async () =>
			page.evaluate(() =>
				Array.from(document.querySelectorAll('.table-cell')).map(
					(c) => window.getComputedStyle(c as HTMLElement).textAlign
				)
			);
		const stylesBefore = await captureCellAligns();

		await test.step('undo brings back the source and the live alignments', async () => {
			await page.locator('.table-cell').nth(0).click();
			await page.keyboard.press('Alt+Shift+Backspace');
			await editor.bridge.waitForSourceEquals(TABLE_ALIGNED_LESS_A);
			await editor.undo();
			await editor.bridge.waitForSourceEquals(TABLE_ALIGNED);
			expect(await captureCellAligns()).toEqual(stylesBefore);
		});

		await test.step('a column edit after the undo still reaches every row', async () => {
			await page.locator('.table-cell').nth(0).click();
			await page.keyboard.press('Alt+Shift+Backspace');
			await editor.bridge.waitForSourceEquals(TABLE_ALIGNED_LESS_A);
			await page.locator('.table-cell').nth(0).click();
			await page.keyboard.press('Alt+Shift+ArrowRight');
			await editor.bridge.waitForSourceContains('| B |  | C | D |');
		});

		await test.step('delete, undo, delete, undo cycles back to the original', async () => {
			await editor.undo();
			await editor.undo();
			await editor.bridge.waitForSourceEquals(TABLE_ALIGNED);
			await page.locator('.table-cell').nth(0).click();
			await page.keyboard.press('Alt+Shift+Backspace');
			await editor.bridge.waitForSourceEquals(TABLE_ALIGNED_LESS_A);
			await editor.undo();
			await editor.bridge.waitForSourceEquals(TABLE_ALIGNED);
		});

		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});

	test('deleting the last row or column lands focus on a surviving cell', async ({ page }) => {
		const pageErrors = capturePageErrors(page);

		await test.step('last body row', async () => {
			await editor.loadContent(TABLE_3ROW);
			// Header + 2 body rows = 6 cells; focus a cell in the last body row (cell index 4).
			await page.locator('.table-cell').nth(4).click();
			await expect(page.locator('.table-cell').nth(4)).toBeFocused();

			await page.keyboard.press('ControlOrMeta+Shift+Backspace');
			await editor.bridge.waitForSourceNotContains('| 3 | 4 |');
			await expect(page.locator('.table-cell')).toHaveCount(4);
			// Targeting the removed last row leaves focus on `<body>` and a `:focus` count of 0.
			await expect(page.locator('.table-cell:focus')).toHaveCount(1);
		});

		await test.step('last column', async () => {
			await editor.loadContent(TABLE_2x2);
			// A body cell in the last column (row 1, col 1, cell index 3).
			await page.locator('.table-cell').nth(3).click();
			await expect(page.locator('.table-cell').nth(3)).toBeFocused();

			await page.keyboard.press('Alt+Shift+Backspace');
			await editor.bridge.waitForSourceNotContains(' B ');
			await expect(page.locator('.table-cell')).toHaveCount(2);
			await expect(page.locator('.table-cell:focus')).toHaveCount(1);
		});

		expect(pageErrors).toEqual([]);
	});
});

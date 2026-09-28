import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Where the caret lands after each table edit, read by typing into it.
// Requirements: `requirements/blocks/table/action-landing.md`.

const TABLE_3ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_3COL = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';

// Header plus `bodyRows` rows, `rk` in row k's first cell: tall enough that far rows window out.
function tallTable(bodyRows: number): string {
	const lines = ['| key | val |', '| --- | --- |'];
	for (let i = 1; i <= bodyRows; i++) lines.push(`| r${i} | v${i} |`);
	return lines.join('\n') + '\n';
}

test.describe('table block: the caret after a table edit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const cell = (i: number) => editor.page.locator('.table-cell').nth(i);

	async function typeX(): Promise<void> {
		await editor.page.keyboard.type('x');
	}

	test('insert row below lands in the new row’s first cell', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await cell(3).click(); // "2": row 1, col 1
		await page.keyboard.press('ControlOrMeta+Enter');
		await typeX();
		await editor.bridge.waitForSourceContains('| 1 | 2 |\n| x |  |\n| 3 | 4 |');
	});

	test('insert row above lands in the new row’s first cell', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await cell(5).click(); // "4": row 2, col 1
		await page.keyboard.press('ControlOrMeta+Shift+Enter');
		await typeX();
		await editor.bridge.waitForSourceContains('| 1 | 2 |\n| x |  |\n| 3 | 4 |');
	});

	test('insert column right lands in the new column, on the same row', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await cell(4).click(); // "3": row 2, col 0
		await page.keyboard.press('Alt+Shift+ArrowRight');
		await typeX();
		await editor.bridge.waitForSourceContains('| 3 | x | 4 |');
	});

	test('move row down lands at the start of the moved cell', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await cell(3).click(); // "2": row 1, col 1
		await page.keyboard.press('Alt+ArrowDown');
		await typeX();
		await editor.bridge.waitForSourceContains('| 3 | 4 |\n| 1 | x2 |');
	});

	test('move column right lands at the start of the moved cell', async ({ page }) => {
		await editor.loadContent(TABLE_3COL);
		await cell(3).click(); // "1": row 1, col 0
		await page.keyboard.press('Alt+ArrowRight');
		await typeX();
		await editor.bridge.waitForSourceContains('| 2 | x1 | 3 |');
	});

	test('delete row lands in the row that took its place, same column', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await cell(3).click(); // "2": row 1, col 1
		await page.keyboard.press('ControlOrMeta+Shift+Backspace');
		await typeX();
		await editor.bridge.waitForSourceContains('| 3 | x4 |');
		await editor.bridge.waitForSourceNotContains('| 1 |');
	});

	test('delete column lands in the column that took its place, same row', async ({ page }) => {
		await editor.loadContent(TABLE_3COL);
		await cell(4).click(); // "2": row 1, col 1
		await page.keyboard.press('Alt+Shift+Backspace');
		await typeX();
		await editor.bridge.waitForSourceContains('| 1 | x3 |');
	});

	test('an alignment from the menu lands back in the cell the menu opened on', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await cell(3).click({ button: 'right' }); // "2": row 1, col 1
		await page.getByRole('button', { name: 'Right' }).click();
		await editor.bridge.waitForSourceContains('| --- | ---: |');
		await expect(page.getByRole('menu')).toHaveCount(0);
		await typeX();
		await editor.bridge.waitForSourceContains('| 1 | x2 |');
	});

	test('a pasted grid lands at the end of its last cell', async () => {
		await editor.loadContent(TABLE_3ROW);
		await cell(2).click(); // "1": row 1, col 0
		await editor.seedClipboard('p\tq\ns\tt\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('| s | t |');
		await typeX();
		await editor.bridge.waitForSourceContains('| s | tx |');
	});

	test('a 40-row grid pasted past the rendered rows lands in its last cell once that row mounts', async ({
		page
	}) => {
		// Fixed viewport so the rendered rows are the same on every run.
		await page.setViewportSize({ width: 1280, height: 720 });
		await editor.loadContent(tallTable(300));
		const lastRow = 39;
		// The precondition: the row the grid ends on is not rendered when the paste lands.
		await expect(page.locator(`[data-table-row-idx="${lastRow}"]`)).toHaveCount(0);
		await cell(0).click(); // "key": row 0, col 0
		const grid = Array.from({ length: lastRow + 1 }, (_, r) => `g${r}\th${r}`).join('\n');
		await editor.seedClipboard(grid + '\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains(`| g${lastRow} | h${lastRow} |`);
		await typeX();
		await editor.bridge.waitForSourceContains(`| g${lastRow} | h${lastRow}x |`);
	});
});

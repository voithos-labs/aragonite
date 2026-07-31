import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const TABLE_2x2 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

type CursorSurface = {
	exists: boolean;
	cursorOffset: number | null;
	cursorPosition: { path: number[]; offset: number } | null;
};

async function readTableSurface(page: import('@playwright/test').Page): Promise<CursorSurface> {
	return page.evaluate(() =>
		(
			window as unknown as { __test: { getBlockCursorSurface(p: number[]): CursorSurface } }
		).__test.getBlockCursorSurface([0])
	);
}

test.describe('table block: BlockComponent cursor contract', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_2x2);
	});

	test('caret in (rowIdx=1, colIdx=1): shallow getCursorOffset is null, deep getCursorPosition reports [1,1]', async ({
		page
	}) => {
		// Click the body-row second cell — "2" — and place caret at offset 1 (end).
		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('End');

		const surface = await readTableSurface(page);
		expect(surface.exists).toBe(true);
		// Null-shallow contract: 2D surfaces never report a shallow integer.
		expect(surface.cursorOffset).toBeNull();
		expect(surface.cursorPosition).not.toBeNull();
		expect(surface.cursorPosition!.path).toEqual([1, 1]);
		expect(surface.cursorPosition!.offset).toBe(1);
	});

	test('caret at origin (rowIdx=0, colIdx=0): shallow getCursorOffset still returns null', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Home');

		const surface = await readTableSurface(page);
		expect(surface.exists).toBe(true);
		// (0,0) is not a special-cased zero — the contract is "no shallow offset for tables".
		expect(surface.cursorOffset).toBeNull();
		expect(surface.cursorPosition).not.toBeNull();
		expect(surface.cursorPosition!.path).toEqual([0, 0]);
		expect(surface.cursorPosition!.offset).toBe(0);
	});

	test('no cell focused: shallow and deep both return null', async ({ page }) => {
		// No other block exists in this loader, so blurring to <body> is the only way outside a
		// cell.
		await page.evaluate(() => {
			(document.activeElement as HTMLElement | null)?.blur();
		});

		const surface = await readTableSurface(page);
		expect(surface.exists).toBe(true);
		expect(surface.cursorOffset).toBeNull();
		expect(surface.cursorPosition).toBeNull();
	});
});

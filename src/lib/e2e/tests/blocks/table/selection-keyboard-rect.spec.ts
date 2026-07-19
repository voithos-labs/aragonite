import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Table at block [1] with a paragraph on each side so either vertical exit lands.
const DOC =
	'before\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\nafter\n';

test.describe('table block: rectangular selection by keyboard', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	test('Shift+ArrowDown extends the rectangle one row per press, then exits', async ({ page }) => {
		// cellIdx 4 = body row 0, col 1 ("2"); DOM cell order matches cellIdx at 3 cols.
		await page.locator('[role="cell"]').nth(4).click();

		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		let sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor).toEqual({ path: [1], offset: 4 });
		// Down one row is cellIdx 7, not the next doc-order cell (5) nor cellIdx 0.
		expect(sel!.focus).toEqual({ path: [1], offset: 7 });

		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForRenderFlush();
		sel = await editor.bridge.getSelectionPaths();
		expect(sel!.focus).toEqual({ path: [1], offset: 10 });

		// At the last row, the next press exits the table downward (cross-block).
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForRenderFlush();
		sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.path).toEqual([1]);
		expect(sel!.focus.path).not.toEqual([1]);
	});

	test('Shift+ArrowUp extends up one row per press, then exits upward', async ({ page }) => {
		// cellIdx 10 = body row 2, col 1 ("8").
		await page.locator('[role="cell"]').nth(10).click();

		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);
		let sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor).toEqual({ path: [1], offset: 10 });
		expect(sel!.focus).toEqual({ path: [1], offset: 7 });

		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForRenderFlush();
		sel = await editor.bridge.getSelectionPaths();
		expect(sel!.focus).toEqual({ path: [1], offset: 4 });

		// Climb into the header row, then the next press exits above the table.
		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForRenderFlush();
		sel = await editor.bridge.getSelectionPaths();
		expect(sel!.focus).toEqual({ path: [1], offset: 1 });

		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForRenderFlush();
		sel = await editor.bridge.getSelectionPaths();
		expect(sel!.focus.path).not.toEqual([1]);
	});
});

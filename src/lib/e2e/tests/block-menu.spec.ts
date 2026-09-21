import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// The trailing insert row and the block menu: a click on the row adds a paragraph at the end of
// the document, and every menu the editor opens is driven by the keyboard without taking focus,
// so the caret it acts on stays where it is. The menu rows here are the prose right-click
// menu's, which is how the editor inserts a block.
// Requirements: `e2e/requirements/block-menu.md`.

const TAIL_ROW = { name: 'Add a line below' };
const BLOCK_MENU = { name: 'Block actions' };

/** The right-click menu on a paragraph: the clipboard rows, then the "Insert block" flyout. */
async function openProseMenu(editor: EditorPage): Promise<void> {
	await editor.getBlock(0).click({ button: 'right' });
	await expect(editor.page.getByRole('menu', BLOCK_MENU)).toBeVisible();
}

test.describe('trailing insert row and the block menu', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('clicking the tail row adds an empty paragraph and lands the caret in it', async ({
		page
	}) => {
		await editor.loadContent('```\ncode\n```\n');
		await page.getByRole('button', TAIL_ROW).click();
		await editor.bridge.waitForBlockCount(2);
		await page.keyboard.type('after');
		await editor.bridge.waitForSourceContains('after');
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n\nafter\n');
	});

	test('a drag that starts on the tail row selects, and adds no paragraph', async ({ page }) => {
		await editor.loadContent('first para\n\nsecond para\n');
		const tail = await page.locator('.editor-tail').boundingBox();
		const last = await editor.getBlock(1).boundingBox();
		if (!tail || !last) throw new Error('no layout box');

		// Up and to the left, from the strip into the text of the block above it. The end point is
		// well inside that text: past its last glyph the range would be the empty tail of the line.
		const from = { x: last.x + last.width * 0.7, y: tail.y + tail.height / 2 };
		const to = { x: last.x + 20, y: last.y + last.height / 2 };
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let step = 1; step <= 6; step++) {
			await page.mouse.move(
				from.x + ((to.x - from.x) * step) / 6,
				from.y + ((to.y - from.y) * step) / 6
			);
		}
		await page.mouse.up();
		await editor.waitForRenderFlush();

		expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('para');
		// The strip's click appends only for a press that stayed put.
		expect(await editor.bridge.getSource()).toBe('first para\n\nsecond para\n');
	});

	test('ArrowUp wraps to the last row, and a picked row closes the menu', async ({ page }) => {
		await editor.loadContent('first\n');
		await openProseMenu(editor);
		const menu = page.getByRole('menu', BLOCK_MENU);
		await page.keyboard.press('ArrowUp');
		// The last selectable row: the "Insert block" flyout ends the prose menu.
		await expect(menu.locator('[data-active="true"]')).toHaveText('Insert block');
		await page.keyboard.press('ArrowDown');
		// Cut and Copy are disabled with no selection, so the first row the walk stops on is Paste.
		await expect(menu.locator('[data-active="true"]')).toHaveText('Paste');
	});

	test('Escape closes the menu and inserts nothing', async ({ page }) => {
		await editor.loadContent('first\n');
		await openProseMenu(editor);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu', BLOCK_MENU)).toHaveCount(0);
		await page.keyboard.type('typed');
		await editor.bridge.waitForSourceContains('typed');
		expect(await editor.bridge.getSource()).toContain('typed');
	});

	test('menuChange fires true on open and false on close, once each', async ({ page }) => {
		await editor.loadContent('first\n');
		await page.evaluate(() => (window as any).__test.startMenuChangeCapture());
		await openProseMenu(editor);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await page.evaluate(() => (window as any).__test.stopMenuChangeCapture())).toEqual([
			true,
			false
		]);
	});

	test('a right-click on a block opens its actions, and Remove deletes the block', async ({
		page
	}) => {
		await editor.loadContent('first\n\n```\ncode\n```\n\nlast\n');
		await page.locator('[data-block-kind="fencedCode"]').first().click({ button: 'right' });
		const menu = page.getByRole('menu', { name: 'Block actions' });
		await expect(menu).toBeVisible();
		await menu.getByRole('menuitem', { name: 'Remove code block' }).click();
		await editor.bridge.waitForSourceNotContains('```');
		expect(await editor.bridge.getSource()).toBe('first\n\nlast\n');
	});
});

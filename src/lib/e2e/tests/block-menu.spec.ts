import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// The trailing insert row and the block menu behind its `+`: a click on the row adds a paragraph
// at the end of the document, the `+` adds one and opens the insert menu over it, and every menu
// the editor opens is keyboard-driven without taking focus, so the caret it acts on stays put.
// Requirements: e2e/requirements/block-menu.md.

const TAIL_ROW = { name: 'Add a line below' };
const TAIL_PLUS = { name: 'Add a block' };
const INSERT_MENU = { name: 'Insert a block' };

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

	test('the gutter + adds the paragraph and opens the insert menu over it', async ({ page }) => {
		await editor.loadContent('first\n');
		await page.getByRole('button', TAIL_PLUS).click();
		const menu = page.getByRole('menu', INSERT_MENU);
		await expect(menu).toBeVisible();
		await editor.bridge.waitForBlockCount(2);

		// Two steps down from the first row is the to-do list; Enter inserts it at the caret.
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(menu.locator('[data-active="true"]')).toHaveText('To-do list');
		await page.keyboard.press('Enter');
		await expect(menu).toHaveCount(0);
		await editor.bridge.waitForSourceContains('- [ ] ');
		await page.keyboard.type('task');
		await editor.bridge.waitForSourceContains('task');
		expect(await editor.bridge.getSource()).toBe('first\n\n- [ ] task\n');
	});

	test('ArrowUp wraps to the last row, and a picked row closes the menu', async ({ page }) => {
		await editor.loadContent('first\n');
		await page.getByRole('button', TAIL_PLUS).click();
		const menu = page.getByRole('menu', INSERT_MENU);
		await expect(menu).toBeVisible();
		await page.keyboard.press('ArrowUp');
		// The last selectable row: the clipboard group ends the insert menu.
		await expect(menu.locator('[data-active="true"]')).toHaveText('Paste as plain text');
		await page.keyboard.press('ArrowDown');
		await expect(menu.locator('[data-active="true"]')).toHaveText('Bulleted list');
		await page.keyboard.press('Enter');
		await expect(menu).toHaveCount(0);
		await editor.bridge.waitForSourceContains('- ');
	});

	test('Escape closes the menu and leaves the caret where the + put it', async ({ page }) => {
		await editor.loadContent('first\n');
		await page.getByRole('button', TAIL_PLUS).click();
		const menu = page.getByRole('menu', INSERT_MENU);
		await expect(menu).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await page.keyboard.type('typed');
		await editor.bridge.waitForSourceContains('typed');
		expect(await editor.bridge.getSource()).toBe('first\n\ntyped\n');
	});

	test('menuChange fires true on open and false on close, once each', async ({ page }) => {
		await editor.loadContent('first\n');
		await page.evaluate(() => (window as any).__test.startMenuChangeCapture());
		await page.getByRole('button', TAIL_PLUS).click();
		await expect(page.getByRole('menu', INSERT_MENU)).toBeVisible();
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

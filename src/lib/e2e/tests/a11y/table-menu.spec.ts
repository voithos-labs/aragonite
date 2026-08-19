import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table action menu: keyboard + announcements', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('Shift+F10 opens the menu at the focused cell and focuses an enabled item', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');

		await expect(page.getByRole('menu')).toBeVisible();
		await expect(page.locator('[role="menu"] :focus')).toHaveCount(1);
		await expect(page.locator('[role="menuitem"]:focus')).not.toBeDisabled();
	});

	test('the ContextMenu key opens the menu at the focused cell', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('ContextMenu');

		await expect(page.getByRole('menu')).toBeVisible();
		await expect(page.locator('[role="menuitem"]:focus')).not.toBeDisabled();
	});

	test('arrow keys move between items and Enter invokes; the menu closes after', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');

		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('Escape closes the menu and returns focus to the cell', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');
		await expect(page.getByRole('menu')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);

		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z');
	});

	test('Tab keeps focus within the open menu', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');

		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await expect(page.locator('[role="menu"] :focus')).toHaveCount(1);
	});

	test('Shift+Tab keeps focus within the open menu', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');

		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(page.locator('[role="menu"] :focus')).toHaveCount(1);
	});

	test('ArrowUp from the first item wraps to the last stop', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');

		// Roving focus opens on the first enabled item; ArrowUp wraps to the last
		// stop, which is the right segment of the alignment trio.
		await page.keyboard.press('ArrowUp');
		await expect(page.locator('[role="menu"] :focus')).toHaveAttribute('aria-label', 'Right');
	});

	test('arrow navigation skips a disabled mid-list item', async ({ page }) => {
		// First body row: "Move row up" is disabled (a body row can't cross the fixed
		// header) yet sits between two enabled items, so arrow nav must step over it.
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');
		await expect(page.getByRole('menuitem', { name: 'Move row up' })).toBeDisabled();

		const focused = page.locator('[role="menu"] :focus');
		await page.keyboard.press('ArrowDown'); // Insert row above
		await page.keyboard.press('ArrowDown');
		await expect(focused).toHaveText('Insert row below');
		await page.keyboard.press('ArrowDown'); // skips the disabled "Move row up"
		await expect(focused).toHaveText('Move row down');
	});

	test('Left/Right arrows move focus within the alignment trio', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(1).click(); // column B (non-first)
		await expect(page.getByRole('menu')).toBeVisible();

		const focused = page.locator('[role="menu"] :focus');
		await page.keyboard.press('End'); // last stop = the right alignment segment
		await expect(focused).toHaveAttribute('aria-label', 'Right');
		await page.keyboard.press('ArrowLeft');
		await expect(focused).toHaveAttribute('aria-label', 'Center');
		await page.keyboard.press('ArrowLeft');
		await expect(focused).toHaveAttribute('aria-label', 'Left');
		await page.keyboard.press('ArrowRight');
		await expect(focused).toHaveAttribute('aria-label', 'Center');
	});

	test('inserting a column announces it in the live region', async ({ page }) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+ArrowRight');

		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(/insert/i);
	});

	test('deleting a row announces it in the live region', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click(); // first body row
		await page.keyboard.press('ControlOrMeta+Shift+Backspace');

		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(/delet/i);
	});
});

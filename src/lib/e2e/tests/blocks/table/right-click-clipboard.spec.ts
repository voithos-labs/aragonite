import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { dragBetweenCells, readClipboard } from './helpers';

// Cells render row-major: 0=A 1=B (header) · 2="hello" 3="world" (body row).
const TABLE = '| A | B |\n| --- | --- |\n| hello | world |\n';

test.describe('table block: cell right-click clipboard', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await page.evaluate(() => navigator.clipboard.writeText(''));
		await editor.loadContent(TABLE);
	});

	test('the cell menu shows Cut/Copy/Paste; grip menus do not', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /^cut$/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /^copy$/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /^paste$/i })).toBeVisible();
		await page.keyboard.press('Escape');

		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click();
		await expect(page.getByRole('menu')).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /^copy$/i })).toHaveCount(0);
		await expect(page.getByRole('menuitem', { name: /^paste$/i })).toHaveCount(0);
	});

	test('Copy writes the cell selection to the clipboard', async ({ page }) => {
		const cell = page.locator('[role="cell"]').nth(2); // "hello"
		await cell.click();
		await page.keyboard.press('Control+a');
		await cell.click({ button: 'right' }); // right-click inside the selection
		await page.getByRole('menuitem', { name: /^copy$/i }).click();
		await expect.poll(() => readClipboard(page)).toBe('hello');
		// Copy is non-destructive.
		expect(await editor.bridge.getSource()).toContain('| hello | world |');
	});

	test('Cut removes the selection from the cell and writes it to the clipboard', async ({
		page
	}) => {
		const cell = page.locator('[role="cell"]').nth(2); // "hello"
		await cell.click();
		await page.keyboard.press('Control+a');
		await cell.click({ button: 'right' });
		await page.getByRole('menuitem', { name: /^cut$/i }).click();
		await expect.poll(() => readClipboard(page)).toBe('hello');
		await editor.bridge.waitForSourceContains('|  | world |');
		await editor.bridge.waitForSourceNotContains('hello');
	});

	test('Cut is a single undo entry', async ({ page }) => {
		const before = await editor.bridge.getSource();
		const cell = page.locator('[role="cell"]').nth(2);
		await cell.click();
		await page.keyboard.press('Control+a');
		await cell.click({ button: 'right' });
		await page.getByRole('menuitem', { name: /^cut$/i }).click();
		await editor.bridge.waitForSourceNotContains('hello');

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Cut and Copy are disabled with a collapsed caret; Paste stays enabled', async ({
		page
	}) => {
		const cell = page.locator('[role="cell"]').nth(2);
		await cell.click(); // collapsed caret, no selection
		await cell.click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /^cut$/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /^copy$/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /^paste$/i })).toBeEnabled();
	});

	test('Paste inserts clipboard text at the caret', async ({ page }) => {
		// Empty target cell: the caret is at offset 0 wherever the right-click lands,
		// so the paste position is deterministic (a right-click repositions the caret).
		await editor.loadContent('| A | B |\n| --- | --- |\n|  | world |\n');
		await page.evaluate(() => navigator.clipboard.writeText('pasted'));
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' }); // empty body cell
		await page.getByRole('menuitem', { name: /^paste$/i }).click();
		await editor.bridge.waitForSourceContains('| pasted | world |');

		// The cell keeps focus after paste, so typing continues at the caret (native).
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('| pastedZ | world |');
	});

	// The intra-table rectangle suppresses the cell's native selection, so a menu reading
	// hasSelection greys out the very Cut/Copy the rect serves.
	test('Cut/Copy enable for an intra-table rectangle and Copy writes it', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		// Drag a 2×2 body rectangle: cell 2 (row1,col0="1") → cell 5 (row2,col1="4").
		await dragBetweenCells(page, 2, 5);
		await editor.waitForCrossBlock(true);

		// Right-click a rectangle cell preserves the rect (button-2 pointerdown no-ops).
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /^cut$/i })).toBeEnabled();
		await expect(page.getByRole('menuitem', { name: /^copy$/i })).toBeEnabled();

		await page.getByRole('menuitem', { name: /^copy$/i }).click();
		const copied = await readClipboard(page);
		expect(copied).toContain('1');
		expect(copied).toContain('4');
		// Copy is non-destructive.
		expect(await editor.bridge.getSource()).toContain('| 1 | 2 |');
	});

	test('Paste over a selection replaces the selected text', async ({ page }) => {
		await page.evaluate(() => navigator.clipboard.writeText('bye'));
		const cell = page.locator('[role="cell"]').nth(2); // "hello"
		await cell.click();
		await page.keyboard.press('Control+a');
		await cell.click({ button: 'right' });
		await page.getByRole('menuitem', { name: /^paste$/i }).click();
		await editor.bridge.waitForSourceContains('| bye | world |');
	});
});

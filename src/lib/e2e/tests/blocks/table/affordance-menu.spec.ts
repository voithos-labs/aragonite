import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { primaryModifier } from '../../../platform';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_1COL = '| A |\n| --- |\n| 1 |\n';

test.describe('table block: column affordance menu', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('hovering the table reveals column grips; clicking one opens the menu', async ({ page }) => {
		const grips = page.locator('[data-table-col-grip]');
		await expect(grips).toHaveCount(2);

		await page.hover('[role="table"]');
		await grips.nth(0).click();

		await expect(page.getByRole('menu')).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /insert column right/i })).toBeVisible();
	});

	test('Insert column right adds a column after the grip column', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click();
		await page.getByRole('menuitem', { name: /insert column right/i }).click();

		// Header gains a third column: | A |  | B |
		await editor.bridge.waitForSourceMatches(/^\|[^|\n]*\|[^|\n]*\|[^|\n]*\|\s*$/m);
		expect(await editor.bridge.getSource()).toContain('| A |  | B |');
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('Insert column left adds a column before the grip column', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(1).click(); // column B
		await page.getByRole('menuitem', { name: /insert column left/i }).click();

		await editor.bridge.waitForSourceContains('| A |  | B |');
	});

	test('Delete column removes the grip column', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(1).click(); // column B
		await page.getByRole('menuitem', { name: /delete column/i }).click();

		await editor.bridge.waitForSourceMatches(/\| A \|\s*$/m);
		await editor.bridge.waitForSourceNotContains(' B ');
	});

	test('Delete column is disabled when only one column remains', async ({ page }) => {
		await editor.loadContent(TABLE_1COL);
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click();

		const deleteItem = page.getByRole('menuitem', { name: /delete column/i });
		await expect(deleteItem).toBeDisabled();

		const before = await editor.bridge.getSource();
		await deleteItem.click({ force: true });
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Move column left is disabled on the first column', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click();
		await expect(page.getByRole('menuitem', { name: /move column left/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move column right/i })).toBeEnabled();
	});

	test('clicking outside the menu closes it without committing', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click();
		await expect(page.getByRole('menu')).toBeVisible();

		const before = await editor.bridge.getSource();
		// Click clearly outside the menu (it overlaps the small table); to the right
		// of the popover so the click lands on editor content, not a menu item.
		const box = await page.getByRole('menu').boundingBox();
		if (!box) throw new Error('menu has no bounding box');
		await page.mouse.click(box.x + box.width + 80, box.y + box.height / 2);
		await expect(page.getByRole('menu')).toHaveCount(0);
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Escape closes the menu without committing', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click();
		await expect(page.getByRole('menu')).toBeVisible();

		const before = await editor.bridge.getSource();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('a menu-driven mutation is a single undo entry', async ({ page }) => {
		const before = await editor.bridge.getSource();
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click();
		await page.getByRole('menuitem', { name: /insert column right/i }).click();
		await editor.bridge.waitForSourceContains('| A |  | B |');

		await page.keyboard.press(`${primaryModifier}+z`);
		await editor.bridge.waitForSourceNotContains('| A |  | B |');
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('grips do not intercept a header-cell caret click at rest', async ({ page }) => {
		// pointer-events:none until hover keeps the top-of-column grip from stealing
		// a normal caret click into the header cell.
		await page.locator('[role="cell"]').nth(0).click();
		await expect(page.locator('[role="cell"]').nth(0)).toBeFocused();
	});
});

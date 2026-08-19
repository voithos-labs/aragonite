import { test, expect } from '../../../fixtures';
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

	test('Move column right is disabled on the last column', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(1).click(); // column B (last)
		await expect(page.getByRole('menuitem', { name: /move column right/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move column left/i })).toBeEnabled();
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

	test('column grips are pointer-events:none at rest', async ({ page }) => {
		// State query, no interaction: at rest the grip is out of the hit-test path,
		// so it can never steal a caret click before the table is hovered.
		const pe = await page
			.locator('[data-table-col-grip]')
			.first()
			.evaluate((el) => getComputedStyle(el).pointerEvents);
		expect(pe).toBe('none');
	});

	test('a header-cell caret click lands in the cell while hovered', async ({ page }) => {
		// click() hovers first, lifting the grip to pointer-events:auto; its
		// top-of-column geometry still leaves the cell body clickable.
		await page.locator('[role="cell"]').nth(0).click();
		await expect(page.locator('[role="cell"]').nth(0)).toBeFocused();
	});

	test('the alignment control reflects the column current alignment', async ({ page }) => {
		await editor.loadContent('| A | B |\n| :---: | --- |\n| 1 | 2 |\n');
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(0).click(); // center-aligned column A

		const align = page.getByRole('group', { name: 'Column alignment' });
		await expect(align.locator('.alignment-segment.active')).toHaveText('C');
	});

	test('the alignment control sets the targeted (non-first) column to center', async ({ page }) => {
		await editor.loadContent('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(1).click(); // column B
		await page.getByRole('button', { name: 'Center' }).click();

		// Full-row anchor: only B is `:-+:`; A and C stay `-+`, so the test fails if
		// alignment routes to column 0 or 2 instead of the targeted column 1.
		await editor.bridge.waitForSourceMatches(/^\| -+ \| :-+: \| -+ \|$/m);
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('the alignment control sets the targeted (non-first) column to right', async ({ page }) => {
		await editor.loadContent('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(1).click(); // column B
		await page.getByRole('button', { name: 'Right' }).click();

		// Full-row anchor: only B is `-+:`; A and C stay `-+`, so the test fails if
		// alignment routes to column 0 or 2 instead of the targeted column 1.
		await editor.bridge.waitForSourceMatches(/^\| -+ \| -+: \| -+ \|$/m);
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	// Keyboard alignment once dropped focus to <body> and announced nothing: activating a segment
	// must return focus to a cell and announce via the live region. Driven through the menu's real
	// roving focus, not a programmatic press on the segment.
	test('keyboard-driven alignment restores focus to a cell and announces', async ({ page }) => {
		await editor.loadContent('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		await page.locator('[role="cell"]').nth(4).click(); // body row, column B ("2")
		await page.keyboard.press('Shift+F10');
		await expect(page.getByRole('menu')).toBeVisible();

		const focused = page.locator('[role="menu"] :focus');
		await page.keyboard.press('ArrowUp');
		await expect(focused).toHaveAttribute('aria-label', 'Right');
		await page.keyboard.press('ArrowLeft');
		await expect(focused).toHaveAttribute('aria-label', 'Center');
		await page.keyboard.press('Enter');

		await expect(page.getByRole('menu')).toHaveCount(0);
		await editor.bridge.waitForSourceMatches(/^\| -+ \| :-+: \| -+ \|$/m);
		await expect(page.locator(':focus')).toHaveAttribute('role', 'cell');
		await expect(page.locator('.editor-sr-live-reorder')).toContainText('Column aligned center');
	});
});

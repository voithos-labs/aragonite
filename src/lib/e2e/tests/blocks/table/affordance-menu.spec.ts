import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { primaryModifier } from '../../../platform';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_1COL = '| A |\n| --- |\n| 1 |\n';
const TABLE_1ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

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

	test('Move column right is disabled on the last column', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-col-grip]').nth(1).click(); // column B (last)
		await expect(page.getByRole('menuitem', { name: /move column right/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move column left/i })).toBeEnabled();
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

test.describe('table block: row affordance menu', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	// One grip per CST row (the delimiter line is not a row), so nth(0) is the header
	// and nth(1) is the first body row.
	test('one row grip per row; the header grip offers insert/delete but no move or alignment', async ({
		page
	}) => {
		const grips = page.locator('[data-table-row-grip]');
		await expect(grips).toHaveCount(3);

		await page.hover('[role="table"]');
		await grips.nth(0).click(); // header row — positionally fixed

		await expect(page.getByRole('menuitem', { name: /insert row below/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeEnabled();
		await expect(page.getByRole('menuitem', { name: /move row up/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move row down/i })).toBeDisabled();
		await expect(page.getByRole('group', { name: 'Column alignment' })).toHaveCount(0);
	});

	test('Delete row removes that body row', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click(); // first body row
		await page.getByRole('menuitem', { name: /delete row/i }).click();

		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		expect(await editor.bridge.getSource()).toContain('| 3 | 4 |');
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('Insert row below adds a body row after the grip row', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click();
		await page.getByRole('menuitem', { name: /insert row below/i }).click();

		await expect(async () => {
			const lines = (await editor.bridge.getSource()).trim().split('\n');
			expect(lines.length).toBeGreaterThan(4); // header + delimiter + 3 body rows
		}).toPass();
	});

	test('Insert row above adds a body row before the grip row', async ({ page }) => {
		const before = (await editor.bridge.getSource()).trim().split('\n').length;
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click();
		await page.getByRole('menuitem', { name: /insert row above/i }).click();

		await expect(async () => {
			const after = (await editor.bridge.getSource()).trim().split('\n').length;
			expect(after).toBe(before + 1);
		}).toPass();
	});

	test('Move row up is disabled on the first body row, enabled below it', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click(); // first body row
		await expect(page.getByRole('menuitem', { name: /move row up/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move row down/i })).toBeEnabled();
	});

	test('Move row down is disabled on the last body row', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(2).click(); // last body row
		await expect(page.getByRole('menuitem', { name: /move row down/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move row up/i })).toBeEnabled();
	});

	test('Delete row is disabled when only one body row remains', async ({ page }) => {
		await editor.loadContent(TABLE_1ROW);
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click(); // the sole body row

		const deleteItem = page.getByRole('menuitem', { name: /delete row/i });
		await expect(deleteItem).toBeDisabled();

		const before = await editor.bridge.getSource();
		await deleteItem.click({ force: true });
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('row grips are pointer-events:none at rest', async ({ page }) => {
		// At rest the left-gutter dots are out of the hit-test path, so they can't
		// steal a caret click in cell A's left padding before the table is hovered.
		const pe = await page
			.locator('[data-table-row-grip]')
			.first()
			.evaluate((el) => getComputedStyle(el).pointerEvents);
		expect(pe).toBe('none');
	});

	test('a first-cell caret click lands in the cell while hovered', async ({ page }) => {
		// click() hovers first, lifting the row grip to pointer-events:auto; its
		// left-gutter geometry still leaves the cell body clickable.
		const firstBodyCell = page.locator('[role="cell"]').nth(2); // body row, col A ("1")
		await firstBodyCell.click();
		await expect(firstBodyCell).toBeFocused();
	});
});

// Cells render row-major with the header cells first, so for TABLE the role="cell"
// order is: 0=A 1=B (header) · 2="1" 3="2" (body row 1) · 4="3" 5="4" (body row 2).
test.describe('table block: cell right-click menu', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('right-click a cell opens the menu with BOTH row and column actions', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' }); // body cell ("1"), row 1 col 0

		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /delete column/i })).toBeVisible();
	});

	test('Delete column removes the clicked cell column (colIdx routing)', async ({ page }) => {
		await page.locator('[role="cell"]').nth(1).click({ button: 'right' }); // header cell B, col 1
		await page.getByRole('menuitem', { name: /delete column/i }).click();

		await editor.bridge.waitForSourceMatches(/\| A \|\s*$/m); // only column A remains
		await editor.bridge.waitForSourceNotContains(' B ');
	});

	test('Delete row removes the clicked cell row (rowIdx routing)', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' }); // body cell ("1"), row 1
		await page.getByRole('menuitem', { name: /delete row/i }).click();

		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		expect(await editor.bridge.getSource()).toContain('| 3 | 4 |');
	});

	test('right-clicking outside the table does not open the affordance menu', async ({ page }) => {
		await editor.loadContent(`${TABLE}text below\n`);
		await page.getByText('text below').click({ button: 'right' });
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('right-click within an active intra-table rectangle preserves the rectangle', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click(); // body ("1"), row 1 col 0
		await page
			.locator('[role="cell"]')
			.nth(5)
			.click({ modifiers: ['Shift'] }); // ("4"), row 2 col 1
		expect(await page.evaluate(() => (window as any).__test.isCrossBlockActive())).toBe(true);

		// Before the fix, onPointerDown's selection clear ran for any button.
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menu')).toBeVisible();
		expect(await page.evaluate(() => (window as any).__test.isCrossBlockActive())).toBe(true);
	});
});

test.describe('table block: grid markup structure', () => {
	// A whitespace-only text node directly under a raw-walk container joins the raw-offset walk
	// (cursor/widget-offset.ts counts every text node, incl. aria-hidden) and shifts a parked
	// cross-block caret.
	test('no whitespace-only direct text nodes under the table containers (raw-offset-walk contract)', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
		await expect(page.locator('.table-row').first()).toBeVisible();

		const offenders = await page.evaluate(() => {
			const out: string[] = [];
			document.querySelectorAll('.table-block, .table-row').forEach((el) => {
				el.childNodes.forEach((n) => {
					const text = n.textContent ?? '';
					if (n.nodeType === Node.TEXT_NODE && text.length > 0 && text.trim() === '') {
						out.push((el as HTMLElement).className);
					}
				});
			});
			return out;
		});

		expect(offenders).toEqual([]);
	});
});

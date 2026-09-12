import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openFlyout } from './helpers';

// The cell menu's dismissal, and the two switches it does NOT hang off: the drag-handle prop
// and reading mode. Requirements: requirements/blocks/table/menu-policy.md.
const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table block: cell menu dismissal', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('clicking outside the menu closes it without committing', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menu')).toBeVisible();
		const before = await editor.bridge.getSource();

		// Clear of the popover: past its right edge, level with its middle.
		const box = await page.getByRole('menu').boundingBox();
		if (!box) throw new Error('menu has no bounding box');
		await page.mouse.click(box.x + box.width + 80, box.y + box.height / 2);

		await expect(page.getByRole('menu')).toHaveCount(0);
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Escape closes the menu without committing', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menu')).toBeVisible();
		const before = await editor.bridge.getSource();

		await page.keyboard.press('Escape');

		await expect(page.getByRole('menu')).toHaveCount(0);
		// The open menu owns Escape through its own document listener, not a cell surface.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});
});

test.describe('table block: the cell menu and the editor’s switches', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
	});

	// The handle prop governs the pointer grips alone; the menu is a right-click, not a grip.
	test('blockDragHandles=false keeps the menu and its moves', async ({ page }) => {
		await editor.goto('?dragHandles=false');
		await editor.loadContent(TABLE);

		await openFlyout(page, 2, 'Row');
		await page.getByRole('menuitem', { name: 'Move row down' }).click();

		await editor.bridge.waitForSourceMatches(/\| 3 \| 4 \|\n\| 1 \| 2 \|/);
	});

	// Every item mutates the table, so reading mode declines to open it; the browser's own
	// menu (with Copy) shows instead.
	test('reading mode opens no table menu on a cell right-click', async ({ page }) => {
		await editor.goto('?presentationMode=reading');
		await editor.loadContent(TABLE);
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');

		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await editor.waitForRenderFlush();

		await expect(page.getByRole('menu')).toHaveCount(0);
	});
});

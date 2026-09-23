import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { focusedStop } from '../../../../page-probes';

test.describe('task checkbox: accessibility', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('checkbox span carries role=checkbox and aria-checked', async () => {
		await editor.loadContent('- [x] done\n');
		const checkbox = editor.page.locator('.task-checkbox').first();
		await expect(checkbox).toHaveAttribute('role', 'checkbox');
		await expect(checkbox).toHaveAttribute('aria-checked', 'true');
	});

	test('aria-checked flips synchronously with toggle', async () => {
		await editor.loadContent('- [ ] pending\n');
		const checkbox = editor.page.locator('.task-checkbox').first();
		await expect(checkbox).toHaveAttribute('aria-checked', 'false');
		await checkbox.click();
		await expect(checkbox).toHaveAttribute('aria-checked', 'true');
	});

	// The box is reached from the caret, so the item stays one tab stop.
	test('Mod+Enter in a task item toggles its box', async ({ page }) => {
		await editor.loadContent('intro\n\n- [ ] task\n');
		await editor.clickBlock(0);
		await page.keyboard.press('ArrowDown');
		const checkbox = page.locator('.task-checkbox').first();

		await page.keyboard.press('ControlOrMeta+Enter');
		await expect.poll(() => editor.bridge.getSource()).toBe('intro\n\n- [x] task\n');
		await expect(checkbox).toHaveAttribute('aria-checked', 'true');

		await page.keyboard.press('ControlOrMeta+Enter');
		await expect.poll(() => editor.bridge.getSource()).toBe('intro\n\n- [ ] task\n');
		await expect(checkbox).toHaveAttribute('aria-checked', 'false');
	});

	// Shift+Tab leaves a paragraph natively, so it lands on the previous tab stop in the page:
	// the box if it had one, else the item's own editing surface.
	test('Shift+Tab from the next block skips the box', async ({ page }) => {
		await editor.loadContent('- [ ] task\n\nafter\n');
		await expect(page.locator('.task-checkbox').first()).not.toHaveAttribute('tabindex');
		await editor.focusBlockStart(1);
		await page.keyboard.press('Shift+Tab');
		expect(await focusedStop(page)).toEqual({ path: [0, 0, 0], isSurface: true });
	});

	test('Mod+Enter in a plain list item changes nothing', async ({ page }) => {
		await editor.loadContent('intro\n\n- plain\n');
		await editor.clickBlock(0);
		await page.keyboard.press('ArrowDown');
		await editor.pressDeclined('ControlOrMeta+Enter');
		expect(await editor.bridge.getSource()).toBe('intro\n\n- plain\n');
	});

	test('Mod+Enter in a plain item nested under a task leaves the task alone', async ({ page }) => {
		await editor.loadContent('- [ ] parent\n  - child\n');
		await editor.clickBlockAtPath([0, 0, 1, 0, 0], 5);
		await editor.pressDeclined('ControlOrMeta+Enter');
		expect(await editor.bridge.getSource()).toBe('- [ ] parent\n  - child\n');
		await expect(page.locator('.task-checkbox').first()).toHaveAttribute('aria-checked', 'false');
	});
});

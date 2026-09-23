import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

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
		await editor.bridge.waitForSourceContains('- [x] task');
		await expect(checkbox).toHaveAttribute('aria-checked', 'true');

		await page.keyboard.press('ControlOrMeta+Enter');
		await editor.bridge.waitForSourceContains('- [ ] task');
		await expect(checkbox).toHaveAttribute('aria-checked', 'false');
	});

	test('Tab never stops on the box', async ({ page }) => {
		await editor.loadContent('- [ ] task\n- [ ] second\n');
		await editor.clickBlock(0);
		const checkboxes = page.locator('.task-checkbox');
		await expect(checkboxes.first()).not.toHaveAttribute('tabindex');
		await page.keyboard.press('Tab');
		await expect(checkboxes.first()).not.toBeFocused();
		await expect(checkboxes.nth(1)).not.toBeFocused();
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

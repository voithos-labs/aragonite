import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/** An `inline()` widget selected whole gets its own `key` before the editor acts on the key. */

test.describe('a selected inline widget and its own key', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-key');
		await editor.setPresentationMode('live');
		// Raw 3 in block 1 is just before the widget.
		await editor.focusBlockAtPath([1], 3);
		await page.keyboard.press('ArrowRight');
	});

	const source = () => editor.bridge.getSource();

	test('its key writes at its document bytes, and the caret stays in its block', async ({
		page
	}) => {
		await page.keyboard.press('ArrowUp');
		await expect.poll(source).toBe('Before\n\nan {{CHIP}} here\n');
		await page.keyboard.type('x');
		await expect.poll(source).toMatch(/^Before\n\nan .*x.*\n$/);
	});

	test('a key it declines goes on to the editor', async ({ page }) => {
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('x');
		await expect.poll(source).toBe('Before\n\nan {{chip}}x here\n');
	});
});

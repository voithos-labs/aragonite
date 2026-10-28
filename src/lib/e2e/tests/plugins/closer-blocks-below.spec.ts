import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// A construct backed out at the top of a stretch of blocks takes them all in once a closer is
// typed below them, as a reload of the same bytes reads it.

test.describe('a closer typed blocks below the construct it finishes', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('a `:::` typed under the `<div>` in an unclosed `:::note` closes it', async ({ page }) => {
		await editor.loadContent(':::note\n<div>\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		await editor.focusBlockEnd(1);
		await page.keyboard.press('Enter');
		await page.keyboard.type(':::');

		await expect.poll(() => editor.bridge.getSource()).toBe(':::note\n<div>\n\n:::\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.parseConverged()).toBe(true);
	});

	test('a `$$` typed two blocks under an unclosed `$$` closes it', async ({ page }) => {
		await editor.loadContent('$$\n<div>\n\nx\n');
		expect(await editor.bridge.getBlockCount()).toBe(3);
		await editor.focusBlockEnd(2);
		await page.keyboard.press('Enter');
		await page.keyboard.type('$$');

		await expect.poll(() => editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.parseConverged()).toBe(true);
	});

	test('a fence shortened above a closer gets its own, and Undo backs it out', async ({ page }) => {
		const source = '::::note\n\nx\n\n:::\n';
		await editor.loadContent(source);
		expect(await editor.bridge.getBlockCount()).toBe(3);
		await editor.focusBlockStart(0);
		await page.keyboard.press('Delete');

		await expect.poll(() => editor.bridge.getSource()).toBe(':::note\n:::\n\nx\n\n:::\n');
		expect(await editor.bridge.getBlockCount()).toBe(3);
		expect(await editor.parseConverged()).toBe(true);

		await editor.undo();
		await expect.poll(() => editor.bridge.getSource()).toBe(source);
		expect(await editor.bridge.getBlockCount()).toBe(3);
		expect(await editor.parseConverged()).toBe(true);
	});

	test('a line that closes nothing under an unclosed `$$` leaves the blocks as they were', async ({
		page
	}) => {
		await editor.loadContent('$$\n\nfoo\n');
		await editor.focusBlockEnd(1);
		await page.keyboard.type('d');

		await expect.poll(() => editor.bridge.getSource()).toBe('$$\n\nfood\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.parseConverged()).toBe(true);
	});
});

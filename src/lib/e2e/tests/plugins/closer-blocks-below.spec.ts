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

	test('a fence shortened above a closer takes it, and Undo backs it out', async ({ page }) => {
		const source = '::::note\n\nx\n\n:::\n';
		await editor.loadContent(source);
		expect(await editor.bridge.getBlockCount()).toBe(3);
		await editor.focusBlockStart(0);
		await page.keyboard.press('Delete');

		await expect.poll(() => editor.bridge.getSource()).toBe(':::note\n\nx\n\n:::\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);
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

// An opener a key broke and a second key put back finds its closing line still below.
test.describe('an opener put back over the closing line it lost', () => {
	for (const [name, start, steps] of [
		['a letter between the colons, then Backspace', 2, ['x', 'Backspace']],
		['a colon taken out, then typed back', 3, ['Backspace', ':']]
	] as const) {
		test(name, async ({ page }) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('admonitions');
			const source = 'above\n\n:::tip T\nbody\n:::\n\nafter\n';
			await editor.loadContent(source);
			await editor.setPresentationMode('source');
			await editor.focusBlockAtPath([1, 0], start);
			await page.keyboard.press(steps[0]);
			await expect.poll(() => editor.bridge.getSource()).not.toBe(source);
			await page.keyboard.press(steps[1]);

			await expect.poll(() => editor.bridge.getSource()).toBe(source);
			expect(await editor.parseConverged()).toBe(true);
			await editor.undo();
			await expect.poll(() => editor.bridge.getSource()).not.toBe(source);
		});
	}
});

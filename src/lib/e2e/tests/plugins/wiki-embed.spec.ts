import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * An inline rung that mints a BUILT-IN `image` over `![[path|width]]`. Every read path treats it as
 * an image, which is the point; the write paths must not, and before `rewriteImage` existed a
 * resize replaced the embed with a plain inline image. Only the real gesture proves it: the
 * corruption is invisible to a round-trip check, because the document round-trips perfectly — as
 * something else.
 */

const EMBED = '![[/test-fixtures/sample.png|400]]';

test.describe('plugin wiki embed minted as a built-in image', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('wiki-embed');
	});

	test('renders the embed as an image widget with its bytes intact', async () => {
		await expect(editor.page.locator('[data-image-widget]')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain(EMBED);
	});

	test('Shift+ArrowRight resizes in the embed syntax, not GFM', async ({ page }) => {
		await page.locator('[data-image-widget]').first().click();
		await page.keyboard.press('Shift+ArrowRight');
		await editor.bridge.waitForSourceContains('|420');
		const src = await editor.bridge.getSource();
		expect(src).toContain('![[/test-fixtures/sample.png|420]]');
		expect(src).not.toContain('](');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a handle drag resizes in the embed syntax too', async ({ page }) => {
		await page.locator('[data-image-widget]').first().click();
		const handle = page.locator('.md-resize-handle-right').first();
		await handle.waitFor({ state: 'visible' });
		const box = await handle.boundingBox();
		if (!box) throw new Error('handle missing');
		await page.mouse.move(box.x + 4, box.y + 4);
		await page.mouse.down();
		await page.mouse.move(box.x + 4 - 100, box.y + 4, { steps: 10 });
		await page.mouse.up();
		await editor.bridge.waitForSourceNotContains('|400');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/!\[\[\/test-fixtures\/sample\.png\|\d+\]\]/);
		expect(src).not.toContain('](');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('one undo restores the original embed bytes', async ({ page }) => {
		await page.locator('[data-image-widget]').first().click();
		await page.keyboard.press('Shift+ArrowRight');
		await editor.bridge.waitForSourceContains('|420');
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceContains(EMBED);
	});
});

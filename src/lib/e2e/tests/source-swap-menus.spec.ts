import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { enterPresentationMode } from './presentation/helpers';
import { CARD, openCardOn } from './presentation/link-card-helpers';
import { PluginsPage } from './plugins/helpers';

// A `source` swap replaces the document under whatever menu is open, and each menu acts on a
// block or bytes of the outgoing one, so the swap closes them all.
test.describe('a source swap closes every open menu', () => {
	const INCOMING = 'alpha\n\nbeta\n\ngamma\n';

	test('the block menu closes, reports closing, and its pick never runs', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('first\n\n```\ncode\n```\n\nlast\n');
		await page.evaluate(() => (window as any).__test.startMenuChangeCapture());
		await page.locator('[data-block-kind="fencedCode"]').first().click({ button: 'right' });
		await expect(page.getByRole('menu', { name: 'Block actions' })).toBeVisible();

		await editor.loadContent(INCOMING);

		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await page.evaluate(() => (window as any).__test.stopMenuChangeCapture())).toEqual([
			true,
			false
		]);
		expect(await editor.bridge.getSource()).toBe(INCOMING);
	});

	test('the link card closes', async ({ page }) => {
		const editor = await enterPresentationMode(
			page,
			'live',
			'Visit [example](https://example.com) now\n'
		);
		await openCardOn(editor, page, 'example');

		await editor.loadContent(INCOMING);

		await expect(page.locator(CARD)).toHaveCount(0);
	});

	test('the inline menu closes', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(2);
		await editor.typeText(' #');
		await expect(page.locator('[data-inline-menu]')).toBeVisible();

		await editor.loadContent(INCOMING);

		await expect(page.locator('[data-inline-menu]')).toHaveCount(0);
	});
});

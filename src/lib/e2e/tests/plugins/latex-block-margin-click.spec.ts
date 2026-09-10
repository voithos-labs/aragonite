import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// The rendered equation sits centred in a view as wide as the block, so most of that view is not
// the equation: a click there, or in the editor's padding level with the block, is a click on
// nothing and must not open the source. The equation itself still opens on a click.
// Requirements: e2e/requirements/plugins/latex-block-margin-click.md.

test.describe('block math: clicks beside the equation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		await editor.setPresentationMode('live');
	});

	const revealed = (page: PluginsPage['page']) => page.locator('.math-block-editing');

	test('a click in the view beside the equation opens nothing', async ({ page }) => {
		const box = await page.locator('.math-block-render').boundingBox();
		if (!box) throw new Error('no render box');
		await page.mouse.click(box.x + 8, box.y + box.height / 2);
		await page.keyboard.type('!');
		await editor.waitForNoSourceMutation();
		await expect(revealed(page)).toHaveCount(0);
		expect(await editor.bridge.getSource()).not.toContain('!');
	});

	test('a click in the editor padding level with the block opens nothing', async ({ page }) => {
		const root = await editor.editorContainer.boundingBox();
		const host = await page.locator('[data-block-kind="mathBlock"]').boundingBox();
		if (!root || !host) throw new Error('missing boxes');
		await page.mouse.click(root.x + root.width - 4, host.y + host.height / 2);
		await page.keyboard.type('!');
		await editor.waitForNoSourceMutation();
		await expect(revealed(page)).toHaveCount(0);
		expect(await editor.bridge.getSource()).not.toContain('!');
	});

	test('a click on the equation itself still opens its source', async ({ page }) => {
		const box = await page.locator('.math-block-render').boundingBox();
		if (!box) throw new Error('no render box');
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await expect(revealed(page)).toHaveCount(1);
	});
});

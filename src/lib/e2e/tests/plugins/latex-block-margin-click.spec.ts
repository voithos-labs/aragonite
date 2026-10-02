import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { pointInGap } from '../../text-runs';

// The equation's box is the block: a click anywhere in it opens the source, on a glyph or not. The
// editor's padding beside the block is not the block, so a click there opens nothing.
// Requirements: e2e/requirements/plugins/latex-block-margin-click.md.

test.describe('block math: clicks beside the equation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		await editor.setPresentationMode('live');
	});

	const revealed = (page: PluginsPage['page']) => page.locator('.math-block-editing');

	test('a click in the card beside the equation still opens its source', async ({ page }) => {
		const card = page.locator('.math-block-render');
		const box = await card.boundingBox();
		if (!box) throw new Error('no render box');
		const glyphs = card.locator('.katex-html').first();
		const beside = await pointInGap(card, glyphs, 'left', box.y + box.height / 2);
		await page.mouse.click(beside.x, beside.y);
		await expect(revealed(page)).toHaveCount(1);
	});

	test('a click in the editor padding level with the block opens nothing', async ({ page }) => {
		const block = page.locator('[data-block-kind="mathBlock"]');
		const host = await block.boundingBox();
		if (!host) throw new Error('no block box');
		const y = host.y + host.height / 2;
		const margin = await pointInGap(editor.editorContainer, block, 'right', y);
		await page.mouse.click(margin.x, margin.y);
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

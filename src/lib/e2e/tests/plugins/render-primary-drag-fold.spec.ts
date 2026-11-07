import { test, expect } from '../../fixtures';
import { PluginsPage, clickWidgetCenter, dragBetweenPoints } from './helpers';

// A drag that starts in a render-primary leaf's shown source and leaves it ends a range across
// blocks; the release takes focus elsewhere, and the source folds back to its rendered view
// (requirements/plugins/render-primary-drag-fold.md).

const DOC = 'lead para\n\n$$x^2$$\n\ntail para\n';

test.describe('a drag out of a shown render-primary source', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('latex');
		await editor.loadContent(DOC);
		await clickWidgetCenter(editor.page.locator('[data-block-kind="mathBlock"]').first());
		await expect(page.locator('.math-block-source')).toBeVisible();
	});

	async function dragFromSourceToTail(): Promise<void> {
		const source = await editor.page.locator('.math-block-source').boundingBox();
		const tail = await editor.page.getByText('tail para').boundingBox();
		if (!source || !tail) throw new Error('no source or tail box');
		await dragBetweenPoints(
			editor.page,
			{ x: source.x + source.width / 2, y: source.y + source.height / 2 },
			{ x: tail.x + tail.width / 2, y: tail.y + tail.height / 2 }
		);
		await editor.waitForRenderFlush();
	}

	test('the release folds the source and keeps the range', async ({ page }) => {
		await dragFromSourceToTail();

		await expect(page.locator('.math-block-editing')).toHaveCount(0);
		await expect(page.locator('.math-block-render')).toBeVisible();
		expect(await editor.bridge.ownsRange()).toBe(true);
	});

	test('the range copies what lies between its two ends', async ({ page }) => {
		await dragFromSourceToTail();
		const ends = await page.evaluate(() => (window as any).__test.getSelectionPaths());
		expect(ends.anchor.path).toEqual([1]);
		expect(ends.focus.path).toEqual([2]);
		await editor.seedClipboard('');
		await page.keyboard.press('ControlOrMeta+c');

		const head = '$$x^2$$'.slice(ends.anchor.offset);
		const between = `${head}\n\n${'tail para'.slice(0, ends.focus.offset)}`;
		await expect.poll(() => editor.readClipboard()).toBe(between);
		expect(await editor.bridge.getSource()).toBe(DOC);
	});
});

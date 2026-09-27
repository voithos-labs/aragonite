import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Exactly one caret is painted per caret position at an inline-math widget's edge: the plugin
 * counterpart of blocks/image/caret-synthetic-indicator.spec.ts, whose route installs no plugins.
 * Playwright never captures the browser's own caret, so this checks which carets were live, not
 * pixels.
 */

test.describe('inline math: one caret per caret position', () => {
	test('a caret snapped past a trailing math widget suppresses the native one', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('math');
		await editor.loadContent('$x^2$\n');
		const widget = page.locator('.math-inline-widget');
		const box = await widget.boundingBox();
		if (!box) throw new Error('math widget has no bounding box');

		// Right of a widget with no trailing text, the caret sits at an element offset where the editor
		// paints its own caret, so the block's native caret goes dark while that one shows.
		await page.mouse.click(box.x + box.width + 25, box.y + box.height / 2);
		await expect(page.locator('[data-inline-widget].md-snap-after')).toHaveCount(1);
		const caretColor = await page.evaluate(
			() => getComputedStyle(document.querySelector('.text-editable-block')!).caretColor
		);
		expect(caretColor).toBe('rgba(0, 0, 0, 0)');
	});
});

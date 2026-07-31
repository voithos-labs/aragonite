import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Exactly one caret paints for one caret position, at an inline-math widget's edge. The rule is
 * kind-agnostic and lives with the image pins (blocks/image/caret-synthetic-indicator.spec.ts);
 * this is the plugin-surface twin, because the widget the consumer hit it on was math and the
 * image suite runs on a route with no plugins installed. Nothing here can assert the pixel — a
 * control run showed Playwright never captures a native caret — only that both sources were live.
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

		// Click to the right of the widget with no trailing text to anchor in: the caret lands at
		// an element-level offset, where the editor paints a synthetic caret because Chromium's own
		// is unreliable there. When Chromium DOES paint, the user sees two — so the block's own
		// caret goes dark while the synthetic is up, the only mutual exclusion available without
		// asking the browser what it painted.
		await page.mouse.click(box.x + box.width + 25, box.y + box.height / 2);
		await expect(page.locator('[data-inline-widget].md-snap-after')).toHaveCount(1);
		const caretColor = await page.evaluate(
			() => getComputedStyle(document.querySelector('.text-editable-block')!).caretColor
		);
		expect(caretColor).toBe('rgba(0, 0, 0, 0)');
	});
});

import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Exactly one caret is painted for one caret position, at an inline-maths widget's edge. The rule
 * does not depend on the kind and lives with the image tests
 * (blocks/image/caret-synthetic-indicator.spec.ts); this is the plugin counterpart, because the
 * widget a consumer hit it on was maths and the image suite runs on a route with no plugins
 * installed. Nothing here can assert the pixel, since Playwright never captures a browser's own
 * caret, only that both carets were live.
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

		// Click to the right of the widget with no trailing text to land in: the caret goes to an
		// element-level offset, where the editor paints its own caret because Chromium's is
		// unreliable there. When Chromium does paint one the user sees two, so the block's own
		// caret goes dark while the painted one is up, which is the only way to keep them apart
		// without asking the browser what it drew.
		await page.mouse.click(box.x + box.width + 25, box.y + box.height / 2);
		await expect(page.locator('[data-inline-widget].md-snap-after')).toHaveCount(1);
		const caretColor = await page.evaluate(
			() => getComputedStyle(document.querySelector('.text-editable-block')!).caretColor
		);
		expect(caretColor).toBe('rgba(0, 0, 0, 0)');
	});
});

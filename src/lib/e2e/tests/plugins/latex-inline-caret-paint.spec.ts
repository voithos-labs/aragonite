import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { caretsShowing, expectBarBesideWidget } from '../../carets-showing';

/**
 * Exactly one caret shows per caret position at an inline-math widget's edge: the plugin
 * counterpart of blocks/image/caret-synthetic-indicator.spec.ts, whose route installs no plugins.
 */

test.describe('inline math: one caret per caret position', () => {
	test('a caret snapped past a trailing math widget is the drawn bar, and only that', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('math');
		await editor.loadContent('$x^2$\n');
		const widget = page.locator('.math-inline-widget');
		const box = await widget.boundingBox();
		if (!box) throw new Error('math widget has no bounding box');

		// Right of a widget with no trailing text, the caret sits at an element offset the browser
		// draws no caret at, so the editor draws it.
		await page.mouse.click(box.x + box.width + 25, box.y + box.height / 2);
		await expect.poll(() => caretsShowing(page)).toEqual({ native: false, drawn: 1 });
		await expectBarBesideWidget(page, page.locator('[data-inline-widget]'), 'text-height');
	});
});

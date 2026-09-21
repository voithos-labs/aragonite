import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { runCenter } from './multi-click-helpers';

// Triple-click, the block level of the click order, on a widget-dense paragraph
// (`requirements/selection/multi-click-block-widgets.md`), driven on the math seed so the
// formulas are really rendered widgets.

const SHOWCASE_PARAGRAPH =
	'Let a system of plane waves of light, referred to the system of co-ordinates $(x, y, z)$, possess the energy $l$; let the direction of the ray (the wave-normal) make an angle $\\varphi$ with the axis of $x$ of the system. If we introduce a new system of co-ordinates $(\\xi, \\eta, \\zeta)$ moving in uniform parallel translation with respect to the system $(x, y, z)$, and having its origin of co-ordinates in motion along the axis of $x$ with the velocity $v$, then this quantity of light—measured in the system $(\\xi, \\eta, \\zeta)$—possesses the energy\n';

/** The selected text's two ends, so one read pins both boundaries of the range. */
function selectionEnds(page: import('@playwright/test').Page): Promise<[string, string]> {
	return page.evaluate(() => {
		const text = window.getSelection()?.toString() ?? '';
		return [text.slice(0, 27), text.slice(-20)] as [string, string];
	});
}

/** Whether the selection ends at `tail` and opens before it: the read that includes the widget,
 *  for a paragraph whose leading formula renders as text no assertion can spell. */
function reachesBothEnds(
	page: import('@playwright/test').Page,
	tail: string
): Promise<[boolean, boolean]> {
	return page.evaluate((end) => {
		const text = window.getSelection()?.toString() ?? '';
		return [text.endsWith(end), text.length > end.length + 1] as [boolean, boolean];
	}, tail);
}

test.describe('multi-click: the block inline syntax handler beside inline widgets', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('math');
	});

	for (const mode of ['source', 'live'] as const) {
		test(`${mode}: a triple-click takes the whole widget-dense paragraph`, async ({ page }) => {
			await editor.loadContent(SHOWCASE_PARAGRAPH);
			await editor.setPresentationMode(mode);
			await expect(page.locator('[data-inline-widget]')).toHaveCount(9);
			const at = await runCenter(page, 'possess the energy');
			await page.mouse.click(at.x, at.y, { clickCount: 3 });
			const ends: [string, string] = ['Let a system of plane waves', 'possesses the energy'];
			await expect.poll(() => selectionEnds(page)).toEqual(ends);
			// The release has already been handled; a caret placed later would drop the range.
			await page.waitForTimeout(150);
			await expect.poll(() => selectionEnds(page)).toEqual(ends);
		});

		test(`${mode}: a triple-click takes a paragraph that opens on a widget`, async ({ page }) => {
			await editor.loadContent('$x^2$ opens this line\n');
			await editor.setPresentationMode(mode);
			await expect(page.locator('[data-inline-widget]')).toHaveCount(1);
			const at = await runCenter(page, 'opens');
			await page.mouse.click(at.x, at.y, { clickCount: 3 });
			// The rendered formula has no stable spelling, so the range is read at its two ends:
			// it reaches the last word, and it starts far enough back to hold the formula.
			await expect.poll(() => reachesBothEnds(page, 'opens this line')).toEqual([true, true]);
		});
	}
});

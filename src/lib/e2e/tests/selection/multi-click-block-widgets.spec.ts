import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { multiClick, nativeSelectionText, runCenter, widgetCenter } from './multi-click-helpers';

// Triple-click, the block level of the click order, on a widget-dense paragraph
// (`requirements/selection/multi-click-block-widgets.md`), driven on the math seed so the
// formulas are really rendered widgets.

const SHOWCASE_PARAGRAPH =
	'Let a system of plane waves of light, referred to the system of co-ordinates $(x, y, z)$, possess the energy $l$; let the direction of the ray (the wave-normal) make an angle $\\varphi$ with the axis of $x$ of the system. If we introduce a new system of co-ordinates $(\\xi, \\eta, \\zeta)$ moving in uniform parallel translation with respect to the system $(x, y, z)$, and having its origin of co-ordinates in motion along the axis of $x$ with the velocity $v$, then this quantity of light—measured in the system $(\\xi, \\eta, \\zeta)$—possesses the energy\n';

const SHOWCASE_ENDS: [string, string] = ['Let a system of plane waves', 'possesses the energy'];

/** KaTeX paints its glyphs here; the widget's own box also holds a copy clipped to a pixel. */
const KATEX_GLYPHS = '.katex-html';

// An entity is a widget with no source to show, so the reveal never runs and the third click
// is the only thing that can select anything.
const ENTITY_PARAGRAPH = 'before &copy; after some more words on this line\n';

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
			await expect.poll(() => selectionEnds(page)).toEqual(SHOWCASE_ENDS);
			// The release has already been handled; a caret placed later would drop the range.
			await page.waitForTimeout(150);
			await expect.poll(() => selectionEnds(page)).toEqual(SHOWCASE_ENDS);
		});

		test(`${mode}: a triple-click on a rendered formula takes the paragraph`, async ({ page }) => {
			// The first click of the run shows the formula's source and the second takes the whole
			// token, so the third arrives with the widget's own gesture already under way.
			await editor.loadContent(SHOWCASE_PARAGRAPH);
			await editor.setPresentationMode(mode);
			await expect(page.locator('[data-inline-widget]')).toHaveCount(9);
			await multiClick(page, await widgetCenter(page, KATEX_GLYPHS), 3);
			await expect.poll(() => selectionEnds(page)).toEqual(SHOWCASE_ENDS);
			await page.waitForTimeout(150);
			await expect.poll(() => selectionEnds(page)).toEqual(SHOWCASE_ENDS);
		});

		test(`${mode}: typing over that selection replaces the paragraph, formula and all`, async ({
			page
		}) => {
			await editor.loadContent(SHOWCASE_PARAGRAPH);
			await editor.setPresentationMode(mode);
			await expect(page.locator('[data-inline-widget]')).toHaveCount(9);
			await multiClick(page, await widgetCenter(page, KATEX_GLYPHS), 3);
			// The formula re-renders as its source closes, and the range has to come back with it.
			await expect(page.locator('[data-inline-widget]')).toHaveCount(9);
			await expect.poll(() => selectionEnds(page)).toEqual(SHOWCASE_ENDS);
			await page.keyboard.press('X');
			await editor.bridge.waitForSourceContains('X');
			expect(await editor.bridge.getSource()).toBe('X\n');
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

	test('a triple-click on a widget that never shows a source takes the paragraph', async ({
		page
	}) => {
		await editor.loadContent(ENTITY_PARAGRAPH);
		await expect(page.locator('[data-inline-widget]')).toHaveCount(1);
		await multiClick(page, await widgetCenter(page), 3);
		await expect.poll(() => reachesBothEnds(page, 'on this line')).toEqual([true, true]);
		await page.waitForTimeout(150);
		await expect.poll(() => reachesBothEnds(page, 'on this line')).toEqual([true, true]);
	});

	const IMAGE_PARAGRAPH = 'before ![pic|120x80](/test-fixtures/sample.png) after\n';

	/** The document caret beside a selected image: the native range count and the editor's read. */
	function documentCaret(page: import('@playwright/test').Page): Promise<[number, unknown]> {
		return page.evaluate(() => [
			window.getSelection()?.rangeCount ?? 0,
			(window as any).__test.getSelection()
		]);
	}

	for (const clicks of [2, 3]) {
		test(`a ${clicks === 2 ? 'double' : 'triple'}-click on an inline image leaves the image selected, and nothing else`, async ({
			page
		}) => {
			// An image selects whole on its first click and its second opens the crop frame, so the
			// run is the image's from the start: no range and no caret beside it.
			await editor.loadContent(IMAGE_PARAGRAPH);
			await page.waitForFunction(
				() => (document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
			);
			await multiClick(page, await widgetCenter(page), clicks);
			await expect(page.locator('[data-image-overlay]')).toHaveCount(1);
			await page.waitForTimeout(150);
			expect(await nativeSelectionText(page)).toBe('');
			expect(await documentCaret(page)).toEqual([0, null]);
			await page.keyboard.press('X');
			await editor.bridge.waitForSourceContains('X');
			expect(await editor.bridge.getSource()).toBe('before X after\n');
		});
	}
});

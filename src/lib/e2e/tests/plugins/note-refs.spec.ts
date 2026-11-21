import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Footnote references drawn as `inline()` widgets on `depends` (requirements/plugins/note-refs.md),
 * from `routes/test/plugins/note-refs`: each `[^label]` shows the order its label first appears in
 * the document.
 */

const FIRST = 0;
const SECOND = 1;
const PLAIN = 2;

/** The numbers the widgets in block `index` show, in order. */
const numbersIn = (page: Page, index: number): Promise<string[]> =>
	page
		.locator(`[data-block-path="[${index}]"] .note-ref-widget`)
		.evaluateAll((widgets) => widgets.map((widget) => widget.textContent ?? ''));
const keysAsked = (page: Page): Promise<number> =>
	page.evaluate(() => (window as any).__test.perf.snapshot().keysAsked);
const countKeys = (page: Page) =>
	page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});

test.describe('footnote references drawn as widgets on depends', () => {
	test.beforeEach(async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins('note-refs');
		await ep.setPresentationMode('live');
		await expect.poll(() => numbersIn(page, SECOND)).toEqual(['2', '1']);
	});

	test('number every reference by first appearance as the page loads', async ({ page }) => {
		expect(await numbersIn(page, FIRST)).toEqual(['1']);
	});

	test('a reference typed above renumbers a block nobody typed in', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.focusBlock(FIRST, 0);
		await page.keyboard.type('[^a] ');
		await expect.poll(() => ep.bridge.getSource()).toMatch(/^\[\^a\] A first\[\^b\]/);
		await expect.poll(() => numbersIn(page, SECOND)).toEqual(['1', '2']);
		expect(await numbersIn(page, FIRST)).toEqual(['1', '2']);
	});

	test('a key that changes no answer asks one block, the numbers standing', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.focusBlockEnd(PLAIN);
		await countKeys(page);
		await page.keyboard.type('x');
		await ep.waitForRenderFlush();
		expect(await keysAsked(page)).toBe(1);
		expect(await numbersIn(page, SECOND)).toEqual(['2', '1']);
	});
});

import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Footnote numbers painted from `paintDepends` (requirements/plugins/note-numbers-paint.md), from
 * `routes/test/plugins/note-numbers`: each `[^label]` gets a mark numbered by where its label first
 * appears in the document.
 */

const FIRST = 0;
const SECOND = 1;
const PLAIN = 2;

/** The numbers the marks in block `index` show, in order. */
const numbersIn = (page: Page, index: number): Promise<string[]> =>
	page
		.locator(`[data-block-path="[${index}]"] .note-ref`)
		.evaluateAll((marks) => marks.map((mark) => mark.getAttribute('data-note') ?? ''));
const paintedPaths = (page: Page): Promise<string[]> =>
	page.evaluate(() => (window as any).__test.perf.snapshot().paintCallPaths);
const countPaints = (page: Page) =>
	page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});

test.describe('footnote numbers painted from paintDepends', () => {
	test.beforeEach(async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('note-numbers');
		await expect.poll(() => numbersIn(page, SECOND)).toEqual(['2', '1']);
	});

	test('number every reference by first appearance as the page loads', async ({ page }) => {
		expect(await numbersIn(page, FIRST)).toEqual(['1']);
	});

	test('a reference typed above renumbers a block nobody typed in', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.focusBlock(FIRST, 0);
		await page.keyboard.type('[^a] ');
		await expect.poll(() => numbersIn(page, SECOND)).toEqual(['1', '2']);
		expect(await numbersIn(page, FIRST)).toEqual(['1', '2']);
	});

	test('Enter above the references paints the blocks below again, their numbers standing', async ({
		page
	}) => {
		const ep = new PluginsPage(page);
		await ep.focusBlock(FIRST, 0);
		await countPaints(page);
		await page.keyboard.press('Enter');
		await ep.waitForRenderFlush();
		// The blocks nobody typed in, each a block further down: their answers stand at new indexes.
		const painted = new Set(await paintedPaths(page));
		expect([painted.has(String(SECOND + 1)), painted.has(String(PLAIN + 1))]).toEqual([true, true]);
		expect(await numbersIn(page, SECOND + 1)).toEqual(['2', '1']);
	});

	test('a key that changes no answer paints only its own block', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.focusBlockEnd(PLAIN);
		await countPaints(page);
		await page.keyboard.type('x');
		await ep.waitForRenderFlush();
		expect(new Set(await paintedPaths(page))).toEqual(new Set([String(PLAIN)]));
		expect(await numbersIn(page, SECOND)).toEqual(['2', '1']);
	});
});

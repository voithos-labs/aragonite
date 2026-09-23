import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, focusOffset, focusPath } from './helpers';

// A hard break whose bytes do not show draws a dimmed return glyph where they are, so the line
// under it has a visible cause; the glyph is no text, so the caret and the bytes ignore it.
// Requirements: e2e/requirements/presentation/presentation-live-hard-break.md.

/** What the break's mark draws before itself: the glyph, or `none`. */
const glyphOf = (page: Page) =>
	page
		.locator('.md-hard-break')
		.first()
		.evaluate((el) => getComputedStyle(el, '::before').content);

test.describe('the hidden hard break shows a mark', () => {
	test('a pasted two-space break shows the glyph after `one`, and the caret steps over it once', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', 'start\n');
		await clickBlockSettled(ep, 0);
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.evaluate(() => navigator.clipboard.writeText('one  \ntwo\n'));
		await page.keyboard.press('ControlOrMeta+v');
		await ep.bridge.waitForSourceContains('one  \ntwo');

		expect(await glyphOf(page)).toContain('↵');
		expect(await ep.getBlockText(1)).toBe('one  \ntwo\n');

		// The paste leaves the caret after `two`; Home is the start of its own line.
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		expect(await focusOffset(ep)).toBe(6);
		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();
		expect(await focusPath(ep)).toEqual([1]);
		expect(await focusOffset(ep)).toBe(3);
		await page.keyboard.press('ArrowRight');
		await ep.waitForRenderFlush();
		expect(await focusOffset(ep)).toBe(6);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('onetwo');
		await expect(page.locator('.md-hard-break')).toHaveCount(0);
	});

	test('source mode draws the glyph for trailing spaces, not beside a visible backslash', async ({
		page
	}) => {
		await enterPresentationMode(page, 'source', 'spaces  \nnext\n\nslash\\\nnext\n');
		const marks = page.locator('.md-hard-break');
		await expect(marks).toHaveCount(2);
		expect(await marks.nth(0).evaluate((el) => getComputedStyle(el, '::before').content)).toContain(
			'↵'
		);
		expect(await marks.nth(1).evaluate((el) => getComputedStyle(el, '::before').content)).toBe(
			'none'
		);
	});

	test('live mode draws the glyph for the backslash form too', async ({ page }) => {
		await enterPresentationMode(page, 'live', 'slash\\\nnext\n');
		expect(await glyphOf(page)).toContain('↵');
	});
});

import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, focusOffset, focusPath } from './helpers';

// Where markers are hidden, a hard break is a line break and nothing more. Source mode marks the
// trailing-space form, whose bytes are blank there too.
// Requirements: e2e/requirements/presentation/presentation-live-hard-break.md.

const RETURN_GLYPH = '↵';

/** Every return glyph the stylesheet draws in the editor, generated content included. */
const drawnGlyphs = (page: Page) =>
	page
		.locator('.editor')
		.evaluate(
			(root, glyph) =>
				[root, ...root.querySelectorAll('*')].filter((el) =>
					['::before', '::after'].some((at) => getComputedStyle(el, at).content.includes(glyph))
				).length,
			RETURN_GLYPH
		);

const BOTH_FORMS = 'slash\\\nnext\n\nspaces  \nnext\n';

test.describe('a hard break where markers are hidden', () => {
	test('a pasted two-space break draws nothing, and the caret steps over it once', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', 'start\n');
		await clickBlockSettled(ep, 0);
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.evaluate(() => navigator.clipboard.writeText('one  \ntwo\n'));
		await page.keyboard.press('ControlOrMeta+v');
		await ep.bridge.waitForSourceContains('one  \ntwo');

		expect(await drawnGlyphs(page)).toBe(0);
		// The clipboard's closing line ending ends the paragraph; it is not a line inside it.
		expect(await ep.getBlockText(1)).toBe('one  \ntwo');
		expect(await ep.bridge.getSource()).toBe('start\n\none  \ntwo\n');

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
	});

	for (const mode of ['live', 'preview-block'] as const) {
		test(`${mode}: neither the backslash nor the trailing-space form draws a glyph`, async ({
			page
		}) => {
			await enterPresentationMode(page, mode, BOTH_FORMS);
			expect(await drawnGlyphs(page)).toBe(0);
		});
	}

	for (const mode of ['live', 'source'] as const) {
		test(`${mode}: the line Shift+Enter opens at the end draws no glyph`, async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, 'abc\n');
			await clickBlockSettled(ep, 0);
			await page.keyboard.press('End');
			await page.keyboard.press('Shift+Enter');
			await ep.waitForRenderFlush();

			await expect(page.locator('[data-caret-anchor="break"]')).not.toHaveCount(0);
			expect(await drawnGlyphs(page)).toBe(0);
		});
	}
});

test('source mode marks the trailing-space break, not the visible backslash', async ({ page }) => {
	await enterPresentationMode(page, 'source', BOTH_FORMS);
	expect(await drawnGlyphs(page)).toBe(1);
	const marked = await page
		.locator('.block-host')
		.nth(1)
		.evaluate(
			(block, glyph) =>
				[...block.querySelectorAll('*')].some((el) =>
					getComputedStyle(el, '::before').content.includes(glyph)
				),
			RETURN_GLYPH
		);
	expect(marked).toBe(true);
});

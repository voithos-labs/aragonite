import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';
import { textRunEnd } from '../../text-runs';
import { clickBlockSettled, enterPresentationMode } from './helpers';

// Shift+Enter at a block's end opens a line and writes nothing; whatever is inserted next writes
// the break in front of itself, and anything else drops the line without leaving a byte.
// Requirements: e2e/requirements/presentation/pending-break.md.

const MODES = ['source', 'live'] as const;

/** The block's end, then Shift+Enter `times` over. */
async function openBreak(ep: EditorPage, page: Page, times = 1): Promise<void> {
	await clickBlockSettled(ep, 0);
	await page.keyboard.press('End');
	for (let i = 0; i < times; i++) await page.keyboard.press('Shift+Enter');
	await ep.waitForRenderFlush();
}

const breakAnchors = (page: Page) =>
	page.locator('.block-host').first().locator('br[data-caret-anchor="break"]');

for (const mode of MODES) {
	test.describe(`${mode} mode: a backslash typed at a block's end`, () => {
		test('stays a backslash, and the next key types after it', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, 'see C:\n');
			await clickBlockSettled(ep, 0);
			await page.keyboard.press('End');
			await ep.typeSlowly('\\U');
			await expect.poll(() => ep.bridge.getSource()).toBe('see C:\\U\n');
		});
	});

	test.describe(`${mode} mode: the insertion after Shift+Enter at the end`, () => {
		test('two Shift+Enters open two lines, and the caret stays on the second', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, 'abc def\n');
			await openBreak(ep, page, 2);
			expect(await ep.bridge.getSource()).toBe('abc def\n');

			await ep.typeSlowly('x');

			await expect.poll(() => ep.bridge.getSource()).toBe('abc def\\\n\\\nx\n');
		});

		test('a punctuation key starts the new line', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, 'abc\n');
			await openBreak(ep, page);

			await ep.typeSlowly('-');

			await expect.poll(() => ep.bridge.getSource()).toBe('abc\\\n-\n');
		});

		test('a paste starts the new line', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, 'abc\n');
			await ep.seedClipboard('x');
			await openBreak(ep, page);

			await ep.paste();

			await expect.poll(() => ep.bridge.getSource()).toBe('abc\\\nx\n');
		});

		test('a composed run starts the new line', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, 'abc\n');
			await openBreak(ep, page);
			const ime = await attachIme(page);

			await ime.compose('か');
			await ime.commit('か');

			await expect.poll(() => ep.bridge.getSource()).toBe('abc\\\nか\n');
		});
	});

	test.describe(`${mode} mode: a Shift+Enter nothing is typed after`, () => {
		test('leaves no byte and no line once the caret moves to another block', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, 'abc\n\nnext\n');
			await openBreak(ep, page);
			await expect(breakAnchors(page)).toHaveCount(2);

			await clickBlockSettled(ep, 1);

			await expect(breakAnchors(page)).toHaveCount(0);
			expect(await ep.bridge.getSource()).toBe('abc\n\nnext\n');
		});
	});
}

test.describe('live mode: a pending break beside a hidden closer', () => {
	test('ArrowLeft drops the line before the edge step can take the key', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', 'a **bold**\n');
		await openBreak(ep, page);

		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();
		await expect(breakAnchors(page)).toHaveCount(0);
		await ep.typeSlowly('x');

		await expect.poll(() => ep.bridge.getSource()).not.toContain('\\');
	});
});

test.describe('live mode: a paste after an edge step', () => {
	test('lands on the side the step chose', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', 'a **bold** b\n');
		await ep.seedClipboard('X');
		const point = await textRunEnd(page, 'bold');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();
		await page.keyboard.press('ArrowRight');
		await ep.waitForRenderFlush();

		await ep.paste();

		await expect.poll(() => ep.bridge.getSource()).toBe('a **bold**X b\n');
	});
});

test.describe('live mode: a hard break at a block end, emptied again', () => {
	test('Backspace takes the emptied line', async ({ page }) => {
		test.fail(
			true,
			'#690: the edge delete reparses the block without its emptied last line, where the break reads as text'
		);
		const ep = await enterPresentationMode(page, 'live', 'abc def\n');
		await openBreak(ep, page);
		await ep.typeSlowly('x');
		await expect.poll(() => ep.bridge.getSource()).toBe('abc def\\\nx\n');
		await page.keyboard.press('Backspace');
		await ep.waitForRenderFlush();
		const emptied = await ep.bridge.getSource();

		await page.keyboard.press('Backspace');

		await expect.poll(() => ep.bridge.getSource()).not.toBe(emptied);
	});
});

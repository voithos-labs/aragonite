import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';
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

/** Whether the run being composed sits after the open line's first anchor, on the new line. The
 *  browser may swap the line's last anchor for the run, so only the first is looked for. */
const composedAfterBreak = (page: Page, run: string) =>
	page
		.locator('.block-host')
		.first()
		.locator('[contenteditable]')
		.evaluate((el, composed) => {
			const anchor = el.querySelector('br[data-caret-anchor="break"]');
			for (let node = anchor?.nextSibling; node; node = node.nextSibling) {
				if (node.textContent?.includes(composed)) return true;
			}
			return false;
		}, run);

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

test.describe('live mode: a composed run after a hidden closer', () => {
	for (const [source, written] of [
		['a **bold**\n', 'a **bold**\\\nか\n'],
		['an *it*\n', 'an *it*\\\nか\n'],
		['via `code`\n', 'via `code`\\\nか\n']
	]) {
		test(`starts the new line after ${JSON.stringify(source)}, drawn while composing`, async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, 'live', source);
			await openBreak(ep, page);
			const ime = await attachIme(page);

			await ime.compose('か');
			await expect.poll(() => composedAfterBreak(page, 'か')).toBe(true);
			await ime.commit('か');

			await expect.poll(() => ep.bridge.getSource()).toBe(written);
		});
	}
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

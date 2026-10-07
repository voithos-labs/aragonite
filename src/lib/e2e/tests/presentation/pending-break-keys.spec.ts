import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { clickBlockSettled, enterPresentationMode, nextRow } from './helpers';

// A caret key on the line Shift+Enter opened at a block's end moves from that line, where the
// caret is drawn, and the line goes once the caret leaves it. Each test walks its rows as steps,
// every step on a fresh copy of the document.
// Requirements: e2e/requirements/presentation/pending-break-keys.md.

/** Shift+Enter at the end of block `index`, then `key`, then `z`; `drawn` is how many anchors the
 *  open line leaves after the key, before `z`: 2 while it's still there, 0 once it's gone. */
async function keyThenZ(
	ep: EditorPage,
	page: Page,
	index: number,
	key: string,
	drawn?: number
): Promise<void> {
	await clickBlockSettled(ep, index);
	await page.keyboard.press('End');
	await page.keyboard.press('Shift+Enter');
	await ep.waitForRenderFlush();
	await page.keyboard.press(key);
	await ep.waitForRenderFlush();
	if (drawn !== undefined) {
		const block = page.locator('.block-host').nth(index);
		await expect(block.locator('br[data-caret-anchor="break"]')).toHaveCount(drawn);
	}
	await ep.typeSlowly('z');
}

const DOC = 'first\n\nabc\n\nnext\n';

for (const mode of ['source', 'live'] as const) {
	test(`${mode} mode: a caret key on the open line`, async ({ page }) => {
		const ep = await enterPresentationMode(page, mode, DOC);

		for (const [key, written, drawn] of [
			['ArrowUp', 'first\n\nzabc\n\nnext\n', 0],
			['ArrowDown', 'first\n\nabc\n\nznext\n', 0],
			['ArrowRight', 'first\n\nabc\n\nznext\n', 0],
			['Home', 'first\n\nabc\\\nz\n\nnext\n', 2],
			['End', 'first\n\nabc\\\nz\n\nnext\n', 2]
		] as const) {
			await test.step(`${key} moves from the open line`, async () => {
				await nextRow(ep, DOC);
				await keyThenZ(ep, page, 1, key, drawn);
				await expect.poll(() => ep.bridge.getSource()).toBe(written);
			});
		}
	});
}

test('live mode: the open line after a hidden closer', async ({ page }) => {
	const BOLD = 'first\n\na **bold**\n\nnext\n';
	const ep = await enterPresentationMode(page, 'live', BOLD);

	await test.step('ArrowRight leaves the block, as it does after plain text', async () => {
		await nextRow(ep, BOLD);
		await keyThenZ(ep, page, 1, 'ArrowRight');
		await expect.poll(() => ep.bridge.getSource()).toBe('first\n\na **bold**\n\nznext\n');
	});

	await test.step('ArrowLeft drops the line and stops at the text’s end', async () => {
		await nextRow(ep, BOLD);
		await keyThenZ(ep, page, 1, 'ArrowLeft');
		await expect.poll(() => ep.bridge.getSource()).toBe('first\n\na **boldz**\n\nnext\n');
	});
});

test('source mode: the open line of an empty paragraph: ArrowLeft drops the line and stays in the paragraph', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'source', 'first\n');
	await clickBlockSettled(ep, 0);
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await ep.waitForRenderFlush();

	await keyThenZ(ep, page, 1, 'ArrowLeft');

	await expect.poll(() => ep.bridge.getSource()).toBe('first\n\nz\n');
});

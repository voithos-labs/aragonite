import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { clickEnd, clickWordSettled, enterPresentationMode, keys, landAt } from './helpers';
import { textRunEnd } from '../../text-runs';

// A fresh start is plain: Enter and a click past a line's end type outside every format, while a
// click on the text follows the character before the caret.
// Requirements: `e2e/requirements/presentation/presentation-live-fresh-start.md`.

const LINE = 'a **bold**';

/** A point in the blank space past the end of the line holding `word`, in the first block. */
async function pastLineEnd(page: Page, word: string): Promise<{ x: number; y: number }> {
	const { y } = await textRunEnd(page, word);
	const right = await page.evaluate(
		() =>
			document.querySelector('[data-block-path="[0]"] [contenteditable]')!.getBoundingClientRect()
				.right
	);
	return { x: right - 8, y };
}

/** The first block's editable box: its line box, padding included. */
async function lineBox(page: Page): Promise<{ right: number; top: number; bottom: number }> {
	return page.evaluate(() => {
		const r = document
			.querySelector('[data-block-path="[0]"] [contenteditable]')!
			.getBoundingClientRect();
		return { right: r.right, top: r.top, bottom: r.bottom };
	});
}

/** A y in the editor's dead space below the last block, past the tail row a click there appends
 *  a paragraph from. */
async function belowDocumentY(page: Page): Promise<number> {
	const tail = await page.locator('.editor-tail').boundingBox();
	const root = await page.locator('.editor').boundingBox();
	const box = await lineBox(page);
	const under = tail ? tail.y + tail.height : box.bottom;
	return Math.min(under + 8, root!.y + root!.height - 4);
}

async function typed(ep: EditorPage, page: Page, want: string): Promise<void> {
	await page.keyboard.type('X');
	await expect.poll(() => ep.bridge.getSource()).toContain(want);
}

test.describe('live mode: a fresh start is plain', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', LINE);
	});

	test('Enter at the end of a bold line, then a letter, types plain', async ({ page }) => {
		await clickEnd(ep, page, 'bold');
		await keys(ep, page, 'Enter');
		await typed(ep, page, `${LINE}\n\nX`);
		expect(await ep.bridge.getSource()).not.toContain('**X');
	});

	test('Enter in the middle of a bold word starts the new block plain', async ({ page }) => {
		await clickWordSettled(ep, page, 'bold');
		await landAt(ep, page, 6);
		await keys(ep, page, 'Enter');
		await typed(ep, page, '\nX**ld**');
	});

	test('Shift+Enter at the end of a bold line opens a plain line', async ({ page }) => {
		await clickEnd(ep, page, 'bold');
		await keys(ep, page, 'Shift+Enter');
		await typed(ep, page, `${LINE}\\\nX`);
	});

	test('a click past the end of the line types plain', async ({ page }) => {
		const point = await pastLineEnd(page, 'bold');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();
		await typed(ep, page, `${LINE}X`);
	});

	// Miss-analysis: the click row aimed at the run's vertical middle, so no row met the line box's
	// margins past the text, where the text's own rect holds no point.
	for (const [where, at] of [
		['the line box’s top edge', (box: { top: number; bottom: number }) => box.top + 1],
		['the line box’s bottom edge', (box: { top: number; bottom: number }) => box.bottom - 1]
	] as const) {
		test(`a click past the end of the line at ${where} types plain`, async ({ page }) => {
			const box = await lineBox(page);
			await page.mouse.click(box.right - 8, at(box));
			await ep.waitForRenderFlush();
			await typed(ep, page, `${LINE}X`);
		});
	}

	// Below every line is past the last one's end, whether or not the block is mounted.
	test('a click below the last block, past its line’s end, types plain', async ({ page }) => {
		const box = await lineBox(page);
		await page.mouse.click(box.right - 8, await belowDocumentY(page));
		await ep.waitForRenderFlush();
		await typed(ep, page, `${LINE}X`);
	});

	test('a click on the bold’s last letter types bold', async ({ page }) => {
		await clickEnd(ep, page, 'bold');
		await typed(ep, page, 'a **boldX**');
	});

	// Both ends sit past the text, so the caret collapses at the line's end, but the press travelled.
	test('a drag that ends past the line’s end sets nothing', async ({ page }) => {
		const point = await pastLineEnd(page, 'bold');
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		await page.mouse.move(point.x - 40, point.y, { steps: 4 });
		await page.mouse.up();
		await ep.waitForRenderFlush();
		await typed(ep, page, 'a **boldX**');
	});
});

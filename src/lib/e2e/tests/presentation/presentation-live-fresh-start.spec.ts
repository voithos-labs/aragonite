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

	test('a click on the bold’s last letter types bold', async ({ page }) => {
		await clickEnd(ep, page, 'bold');
		await typed(ep, page, 'a **boldX**');
	});

	test('a drag that ends past the line’s end sets nothing', async ({ page }) => {
		const point = await pastLineEnd(page, 'bold');
		const word = await textRunEnd(page, 'bold');
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		await page.mouse.move(word.x - 20, word.y, { steps: 4 });
		await page.mouse.move(point.x, point.y, { steps: 4 });
		await page.mouse.up();
		await ep.waitForRenderFlush();
		await typed(ep, page, 'a **boldX**');
	});
});

import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { enterPresentationMode, focusPath } from './helpers';
import { textRunCenter } from '../../text-runs';

// Where the caret ends up when an edit places it rather than a key step. The source is the
// reference: the caret reports the same offset on either side of a hidden closer, so only the
// bytes tell the two positions apart.
// Requirements: `e2e/requirements/presentation/presentation-live-structural-landing-seat.md`.

const DOC = [
	'A **bold**',
	'',
	'```',
	'fence',
	'```',
	'',
	'Plain tail',
	'',
	'```',
	'other',
	'```'
].join('\n');

const BOLD = 0;
const PLAIN = 2;

const enterLive = (page: Page) => enterPresentationMode(page, 'live', DOC);

/** Exit a fence upward the way a user does: click its body, Home, Backspace. */
async function exitFenceUpward(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await textRunCenter(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();
	await page.keyboard.press('Backspace');
	await ep.waitForRenderFlush();
}

test.describe('live mode: a structural landing follows the character before the caret', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// The landing is on text: the character before the caret is bold, so the byte joins it.
	test('a byte typed after exiting a fence upward joins the bold before it', async ({ page }) => {
		await exitFenceUpward(ep, page, 'fence');
		await expect.poll(() => focusPath(ep)).toEqual([BOLD]);

		await page.keyboard.type('x');
		await ep.bridge.waitForSourceContains('A **boldx**');
	});

	test('the exit press itself deletes nothing: the fence survives it whole', async ({ page }) => {
		await exitFenceUpward(ep, page, 'fence');

		await ep.bridge.waitForSourceContains('```\nfence\n```');
	});

	// The control: the same gesture onto a paragraph with no trailing construct. If this one ever
	// disagreed with the first, the merge would be what moved, not where the caret goes.
	test('a landing on a plain paragraph types plainly', async ({ page }) => {
		await exitFenceUpward(ep, page, 'other');
		await expect.poll(() => focusPath(ep)).toEqual([PLAIN]);

		await page.keyboard.type('x');
		await ep.bridge.waitForSourceContains('Plain tailx');
	});
});

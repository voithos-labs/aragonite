import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { centerOfWord } from './helpers';

// The seat after a caret is placed by a MUTATION rather than by a step. The source is the
// oracle: the caret reports the same offset on either side of a hidden closer, so only the
// bytes distinguish the two seats.
// Requirements: e2e/requirements/presentation/presentation-live-structural-landing-seat.md.

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

async function enterLive(page: Page): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto('?presentationMode=live');
	await ep.loadContent(DOC);
	await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');
	return ep;
}

async function focusPath(ep: EditorPage): Promise<number[]> {
	return (await ep.bridge.getSelectionPaths())?.focus.path ?? [];
}

/** Exit a fence upward the way a user does: click its body, Home, Backspace. */
async function exitFenceUpward(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await centerOfWord(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();
	await page.keyboard.press('Backspace');
	await ep.waitForRenderFlush();
}

test.describe('live mode — a structural landing seats outside the construct it lands on', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// The landing is at the paragraph's end, whose last bytes are a hidden `**`. It was seated
	// there, not stepped there, so the side is construct-relative (live-mode.md § 4.2).
	test('a byte typed after exiting a fence upward lands past the closing marker', async ({
		page
	}) => {
		await exitFenceUpward(ep, page, 'fence');
		await expect.poll(() => focusPath(ep)).toEqual([BOLD]);

		await page.keyboard.type('x');
		await ep.bridge.waitForSourceContains('A **bold**x');
	});

	test('the exit press itself deletes nothing — the fence survives it whole', async ({ page }) => {
		await exitFenceUpward(ep, page, 'fence');

		await ep.bridge.waitForSourceContains('```\nfence\n```');
	});

	// The control: the same gesture onto a paragraph with no trailing construct. If this one
	// ever disagreed with the first, the merge would be what moved, not the seat.
	test('a landing on a plain paragraph types plainly', async ({ page }) => {
		await exitFenceUpward(ep, page, 'other');
		await expect.poll(() => focusPath(ep)).toEqual([PLAIN]);

		await page.keyboard.type('x');
		await ep.bridge.waitForSourceContains('Plain tailx');
	});
});

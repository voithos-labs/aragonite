import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, focusOffset } from './helpers';

// The exit's mirror: a block ENTRY seats CURSOR_END or raw 0, and in live both can sit past the
// block's landable extremes — same pixel as the content edge, but the typing seat reads them as
// inside the construct.
// Requirements: e2e/requirements/presentation/presentation-live-block-entry.md.

const DOC = [
	'A tail [link](https://example.com)',
	'',
	'Next block here',
	'',
	'A tail **bold**',
	'',
	'**bold** opens this'
].join('\n');

const LINK_TAIL = 0;
const MIDDLE = 1;
const BOLD_TAIL = 2;
const BOLD_LEAD = 3;

// `A tail [link](…)`: `link` ends at 12, and 34 is the raw length past the hidden `](…)`.
const LINK_CONTENT_END = 12;
// `A tail **bold**`: `bold` ends at 13, and 15 is the raw length past the closing `**`.
const BOLD_CONTENT_END = 13;

async function arriveFrom(
	ep: EditorPage,
	page: Page,
	block: number,
	key: 'ArrowLeft' | 'ArrowRight'
): Promise<void> {
	await clickBlockSettled(ep, block);
	await page.keyboard.press(key === 'ArrowLeft' ? 'Home' : 'End');
	await ep.waitForRenderFlush();
	await page.keyboard.press(key);
	await ep.waitForRenderFlush();
}

test.describe('live mode — an arrival seats where the walk could have stopped', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	test('entering a block that ends in a link lands on the link’s content end', async ({ page }) => {
		await arriveFrom(ep, page, MIDDLE, 'ArrowLeft');
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([LINK_TAIL]);
		expect(await focusOffset(ep)).toBe(LINK_CONTENT_END);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		// A link never extends at either edge, whatever the arrival.
		expect(await ep.bridge.getSource()).toContain('[link](https://example.com)Z');
	});

	test('entering a block that ends in bold lands on the bold content end', async ({ page }) => {
		await arriveFrom(ep, page, BOLD_LEAD, 'ArrowLeft');
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([BOLD_TAIL]);
		expect(await focusOffset(ep)).toBe(BOLD_CONTENT_END);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		// Arrow arrival from outside: the byte lands past the closing delimiter.
		expect(await ep.bridge.getSource()).toContain('**bold**Z');
	});

	// The mirror of the two rows above, and the reason the seat takes a START sentinel rather
	// than a literal 0: a live split's continuation also seats at 0 and must STAY there
	// (`presentation-live-split.spec.ts:66`), so only an arrival's sentinel moves in.
	test('entering a block that opens with bold lands at its content start', async ({ page }) => {
		await arriveFrom(ep, page, BOLD_TAIL, 'ArrowRight');
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([BOLD_LEAD]);
		expect(await focusOffset(ep)).toBe(2);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		// A line-leading construct seats OUTSIDE, so the byte lands before it.
		expect(await ep.bridge.getSource()).toContain('Z**bold** opens this');
	});

	// The vertical arrival lands by pixel column rather than by sentinel, so it already stopped
	// on a landable offset; pinned so the two arrivals cannot drift apart.
	test('the vertical arrival lands on the same offset', async ({ page }) => {
		await clickBlockSettled(ep, MIDDLE);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await page.keyboard.press('ArrowUp');
		await ep.waitForRenderFlush();

		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([LINK_TAIL]);
		expect(await focusOffset(ep)).toBe(LINK_CONTENT_END);
	});
});

test.describe('source mode — the raw extremes are landable, so nothing moves in', () => {
	test('the same arrival seats at the block’s raw end', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await arriveFrom(ep, page, MIDDLE, 'ArrowLeft');
		expect(await focusOffset(ep)).toBe(34);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('[link](https://example.com)Z');
	});
});

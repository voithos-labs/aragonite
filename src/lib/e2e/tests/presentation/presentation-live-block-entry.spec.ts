import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, focusOffset } from './helpers';

// The mirror of leaving a block: entering one puts the caret at CURSOR_END or raw 0, and in live
// mode both can sit where a typed byte would go inside a construct, at the same pixel as the
// content edge.

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

test.describe('live mode: an arrival puts the caret where the walk could have stopped', () => {
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
		// The character before the caret is bold, so the byte joins it.
		expect(await ep.bridge.getSource()).toContain('**boldZ**');
	});

	// Every offset is clamped where the caret is placed; only a split's continuation keeps byte 0,
	// through CURSOR_EXACT_START (`presentation-live-split.spec.ts`).
	test('entering a block that opens with bold lands at its content start', async ({ page }) => {
		await arriveFrom(ep, page, BOLD_TAIL, 'ArrowRight');
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([BOLD_LEAD]);
		expect(await focusOffset(ep)).toBe(2);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		// At a line start the character after the caret decides, so the byte joins the bold.
		expect(await ep.bridge.getSource()).toContain('**Zbold** opens this');
	});

	// A structural edit also puts the caret at a block's start, and a literal 0 there would sit
	// before a heading's hidden marker run, where the next byte turns the heading into a paragraph.
	test('a reorder landing puts the caret at the content start', async ({ page }) => {
		await ep.loadContent('Alpha\n\n## Beta\n');
		await ep.waitForRenderFlush();
		await clickBlockSettled(ep, 1);
		await page.keyboard.press('Alt+ArrowUp');
		await ep.bridge.waitForSourceMatches(/^## Beta/);
		expect(await focusOffset(ep)).toBe(3);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('## ZBeta');
	});

	// Home in a list item: raw 0 sits behind the hidden marker prefix, where a byte would break the
	// list item; the caret lands at the construct's content start instead.
	test('Home in a list item opening with a construct types inside it', async ({ page }) => {
		await ep.loadContent('- **bold** tail\n');
		await ep.waitForRenderFlush();
		await clickBlockSettled(ep, 0);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		expect(await focusOffset(ep)).toBe(2);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('- **Zbold** tail');
	});

	// Arriving from above or below lands by pixel column, so it already stops on an offset the caret
	// can occupy; checked so the two cannot drift apart.
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

test.describe('source mode: the raw extremes are reachable, so nothing moves in', () => {
	test('the same arrival puts the caret at the block’s raw end', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await arriveFrom(ep, page, MIDDLE, 'ArrowLeft');
		expect(await focusOffset(ep)).toBe(34);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('[link](https://example.com)Z');
	});
});

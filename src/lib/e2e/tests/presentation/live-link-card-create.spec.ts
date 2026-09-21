import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { clickWordSettled, enterPresentationMode, extendTo, landAt } from './helpers';
import { CARD, URL_FIELD } from './link-card-helpers';

// The chord's create half: Mod+K over a selection writes the link when the card commits.
// Requirements: e2e/requirements/presentation/live-link-card-create.md.

const DOC = [
	'Alpha bravo charlie',
	'',
	'Visit [example](https://example.com) now',
	'',
	'| alpha | beta |',
	'| --- | --- |',
	'| plain cell | word |'
].join('\n');

/** Shift-extend `count` glyphs right: a real selection gesture, the shape create acts on. */
async function selectRight(ep: EditorPage, page: Page, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await page.keyboard.press('Shift+ArrowRight');
	}
	await ep.waitForRenderFlush();
}

/** Land at raw offset 6 of block 0 and select `bravo`, the range every create test uses. */
async function selectBravo(ep: EditorPage, page: Page): Promise<void> {
	await clickWordSettled(ep, page, 'Alpha');
	await landAt(ep, page, 6);
	await selectRight(ep, page, 5);
}

test.describe('live-mode link card — the create half of Mod+K', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	test('the chord over a selected word opens an empty card; Enter mints ONE undo entry', async ({
		page
	}) => {
		await selectBravo(ep, page);
		const before = await ep.bridge.getSource();

		await ep.pressDeclined('ControlOrMeta+k');

		// Focused, empty, and the document untouched: the link is written only on commit.
		await expect(page.locator(CARD)).toBeVisible();
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await expect(page.locator(URL_FIELD)).toHaveValue('');
		expect(await ep.bridge.getSource()).toBe(before);

		await page.keyboard.type('https://new.test/b');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('Alpha [bravo](https://new.test/b) charlie');
		await expect(page.locator(CARD)).toHaveCount(0);
		// The caret rule after a card commit: the start of the construct it wrote.
		await expect
			.poll(async () => (await ep.bridge.getSelectionPaths())?.focus)
			.toEqual({ path: [0], offset: 6 });

		await ep.undo();
		await ep.bridge.waitForSourceEquals(before, 3000);
	});

	// The card's field takes focus before the host has placed the anchor, which still sits at the
	// editor's origin: a scrolling focus carried the viewport to the top of the document, and the
	// card, placed a frame later beside the selection, was nowhere on screen.
	test('the chord deep in a scrolled document keeps the scroll and shows the card', async ({
		page
	}) => {
		const filler = Array.from({ length: 60 }, (_, i) => `filler line ${i + 1}`).join('\n\n');
		const ep = await enterPresentationMode(page, 'live', `${filler}\n\nAlpha bravo charlie\n`);
		await ep.scrollEditorTo(10_000_000);
		await clickWordSettled(ep, page, 'Alpha');
		await landAt(ep, page, 6);
		await selectRight(ep, page, 5);
		const scrollTop = () => ep.editorContainer.evaluate((el) => el.scrollTop);
		const before = await scrollTop();
		expect(before).toBeGreaterThan(0);

		await ep.pressDeclined('ControlOrMeta+k');

		await expect(page.locator(URL_FIELD)).toBeFocused();
		await expect(page.locator(CARD)).toBeInViewport();
		// The scroll stays, or nudges DOWN by the card's own height when the selection sits at the
		// bottom edge and the card opens below it; it never runs back toward the top.
		expect(await scrollTop()).toBeGreaterThanOrEqual(before);
	});

	test('Escape leaves the document byte-identical and the selection live', async ({ page }) => {
		await selectBravo(ep, page);
		const before = await ep.bridge.getSource();

		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await page.keyboard.type('https://never.test');

		await page.keyboard.press('Escape');

		await expect(page.locator(CARD)).toHaveCount(0);
		// The card's URL field is its own input, outside every editable element.
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
		// The range is held in the caret-restore state while the card borrows focus; Escape
		// puts it back.
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('bravo');
		expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
	});

	test('a selection crossing a link declines create: no card, not a byte', async ({ page }) => {
		await clickWordSettled(ep, page, 'Visit');
		await landAt(ep, page, 2);
		const before = await ep.bridge.getSource();
		// Extend until the focus sits inside the link text: raw 10 of block 1 is in `example`.
		await extendTo(ep, page, 'ArrowRight', [1], 10);

		await ep.pressDeclined('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		expect(await ep.bridge.getSource()).toBe(before);
	});

	// Three checks deep on purpose, and this is the outcome all three have to produce: the
	// cross-block keydown swallows Mod+K, dispatch declines `link.openCard` over a range, and the
	// card's own create path refuses. The unit tests say which one answered.
	test('a selection spanning two blocks declines create: no card, not a byte', async ({ page }) => {
		await clickWordSettled(ep, page, 'Alpha');
		await landAt(ep, page, 6);
		const before = await ep.bridge.getSource();
		// Extend with real keypresses until the range leaves block 0: which byte the focus stops
		// on is the arrow stepping's business, and this case is only about spanning two blocks.
		for (let i = 0; i < 30 && !(await ep.bridge.isCrossBlockActive()); i++) {
			await page.keyboard.press('Shift+ArrowRight');
			await ep.waitForRenderFlush();
		}
		expect(await ep.bridge.isCrossBlockActive()).toBe(true);

		await ep.pressDeclined('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('a selection inside a table cell declines create', async ({ page }) => {
		await clickWordSettled(ep, page, 'plain');
		await selectRight(ep, page, 3);
		expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
		const before = await ep.bridge.getSource();

		await ep.pressDeclined('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		expect(await ep.bridge.getSource()).toBe(before);
	});
});

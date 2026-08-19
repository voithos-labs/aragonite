import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { clickWordSettled, enterPresentationMode, extendTo, landAt } from './helpers';
import { CARD, URL_FIELD } from './link-card-helpers';

// The chord's create half (#119): Mod+K over a selection mints the construct on commit.
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

/** Shift-extend `count` glyphs right — a real selection gesture, the create target's shape. */
async function selectRight(ep: EditorPage, page: Page, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await page.keyboard.press('Shift+ArrowRight');
	}
	await ep.waitForRenderFlush();
}

/** Land at raw offset 6 of block 0 and select `bravo` — the create rows' shared range. */
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

		await page.keyboard.press('ControlOrMeta+k');

		// Entered, empty, and the document untouched: the construct is minted only on commit.
		await expect(page.locator(CARD)).toBeVisible();
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await expect(page.locator(URL_FIELD)).toHaveValue('');
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);

		await page.keyboard.type('https://new.test/b');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('Alpha [bravo](https://new.test/b) charlie');
		await expect(page.locator(CARD)).toHaveCount(0);
		// The card-commit caret rule: the construct's own start.
		await expect
			.poll(async () => (await ep.bridge.getSelectionPaths())?.focus)
			.toEqual({ path: [0], offset: 6 });

		await ep.undo();
		await ep.bridge.waitForSourceEquals(before, 3000);
	});

	test('Escape leaves the document byte-identical and the selection live', async ({ page }) => {
		await selectBravo(ep, page);
		const before = await ep.bridge.getSource();

		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await page.keyboard.type('https://never.test');

		await page.keyboard.press('Escape');

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
		// The range rides the caret-restore slot while the card borrows focus; Escape re-arms it.
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('bravo');
		expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
	});

	test('a selection crossing a link declines create: no card, not a byte', async ({ page }) => {
		await clickWordSettled(ep, page, 'Visit');
		await landAt(ep, page, 2);
		const before = await ep.bridge.getSource();
		// Extend until the focus sits inside the link text — raw 10 of block 1 is in `example`.
		await extendTo(ep, page, 'ArrowRight', [1], 10);

		await page.keyboard.press('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	// Three guards deep by design, and this is the user-visible outcome all three owe: the
	// cross-block keydown swallows Mod+K, the dispatch seam declines `link.openCard` over a range,
	// and the card's own create door refuses. The unit pins say which one answered.
	test('a selection spanning two blocks declines create: no card, not a byte', async ({ page }) => {
		await clickWordSettled(ep, page, 'Alpha');
		await landAt(ep, page, 6);
		const before = await ep.bridge.getSource();
		// Extend by real presses until the range leaves block 0 — the byte the focus stops on is
		// the walk's business, and this case is about the range spanning blocks at all.
		for (let i = 0; i < 30 && !(await ep.bridge.isCrossBlockActive()); i++) {
			await page.keyboard.press('Shift+ArrowRight');
			await ep.waitForRenderFlush();
		}
		expect(await ep.bridge.isCrossBlockActive()).toBe(true);

		await page.keyboard.press('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('a selection inside a table cell declines create', async ({ page }) => {
		await clickWordSettled(ep, page, 'plain');
		await selectRight(ep, page, 3);
		expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
		const before = await ep.bridge.getSource();

		await page.keyboard.press('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});
});

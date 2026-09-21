import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import {
	FIXTURE_BYTES,
	gotoFlow,
	progressiveScrollTo,
	spacerCount,
	TOP_LEVEL_HOSTS,
	topVisibleHostTop,
	UNWINDOWED_PROSE
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// The `header` slot: the app's own content inside the editor's scroll container, above the
// block list. Mounting it beside `.block-list` rather than around it is what leaves the
// windowing arithmetic alone while the title still scrolls away. The real risk is a header that
// changes height while the user is scrolled deep, which has its own scroll correction.

// Enough to window several screens deep without loading megabytes in every scroll case.
const WINDOWED_BYTES = 500_000;

const headerEl = (page: Page) => page.locator('[data-testid="harness-header"]');

async function gotoWithHeader(page: Page): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto('?header=on');
	return editor;
}

/** Click the page header's control, outside the scroll container, and let the resize reach
 *  the observer that corrects the scroll. */
async function toggleHeaderHeight(editor: EditorPage): Promise<void> {
	await editor.page.locator('[data-testid="header-height-toggle"]').click();
	await editor.waitForResizeObserverFlush();
	await editor.waitForRenderFlush();
}

test('the header mounts beside the block list, above the first block, and scrolls away', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);

	// The case without the prop first: with no header the markup is unchanged, so the checks
	// below are about the slot rather than about the route.
	await editor.goto();
	await expect(page.locator('.editor-header')).toHaveCount(0);

	await editor.goto('?header=on');
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);

	// Beside the list, never around it: windowing finds its list as a direct child of the root
	// (`:scope > .block-list`), which a header wrapped around it would break.
	await expect(page.locator('.editor > .editor-header')).toHaveCount(1);
	await expect(page.locator('.editor > .block-list')).toHaveCount(1);
	await expect(page.locator('.editor-header .block-list')).toHaveCount(0);

	const header = (await headerEl(page).boundingBox())!;
	const firstBlock = (await editor.getBlock(0).boundingBox())!;
	expect(firstBlock.y).toBeGreaterThanOrEqual(header.y + header.height - 1);

	// Measured against the scrollTop as it is, not the one requested: a measure pass after the
	// load can settle the estimated heights a few dozen pixels away from it.
	await editor.scrollEditorTo(300);
	const scrolled = (await headerEl(page).boundingBox())!;
	const scrollTop = await editor.editorContainer.evaluate((el) => el.scrollTop);
	expect(scrollTop).toBeGreaterThan(100);
	expect(header.y - scrolled.y).toBeCloseTo(scrollTop, 0);
	expect(pageErrors).toEqual([]);
});

test('windowing still bounds the mounted set with a header mounted', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	const blockCount = await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);

	await expect(page.locator('.editor > .editor-header')).toHaveCount(1);
	expect(blockCount).toBeGreaterThan(2000);
	expect(await spacerCount(page)).toBeGreaterThan(0);
	// A bound rather than the count without a header: a header takes room from the list, so
	// the window is fairly a few blocks smaller.
	expect(await editor.getDomBlockCount()).toBeLessThan(60);
	expect(pageErrors).toEqual([]);
});

test('a header height change while scrolled deep holds the first visible block in place', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadLargeFixture('many-small-blocks', WINDOWED_BYTES);
	await progressiveScrollTo(editor, 4000);
	await editor.waitForRenderFlush();

	// Both which block it is and where it sits: a correction that overshot into the next block
	// would still leave "some block" at about the same place.
	const before = await topVisibleHostTop(page, { selector: TOP_LEVEL_HOSTS });
	expect(before).not.toBeNull();
	expect(await headerEl(page).evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(
		80,
		0
	);

	await toggleHeaderHeight(editor); // from 80 to 240
	expect(await headerEl(page).evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(
		240,
		0
	);
	const grown = await topVisibleHostTop(page, { selector: TOP_LEVEL_HOSTS });
	expect(grown!.ref).toBe(before!.ref);
	expect(Math.abs(grown!.top - before!.top)).toBeLessThanOrEqual(1);

	// The shrinking case: the same correction runs with a negative difference.
	await toggleHeaderHeight(editor); // from 240 to 80
	const shrunk = await topVisibleHostTop(page, { selector: TOP_LEVEL_HOSTS });
	expect(shrunk!.ref).toBe(before!.ref);
	expect(Math.abs(shrunk!.top - before!.top)).toBeLessThanOrEqual(1);
	expect(pageErrors).toEqual([]);
});

test('at the top of the document a header height change pushes content down', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);

	const before = (await editor.getBlock(0).boundingBox())!;
	await toggleHeaderHeight(editor); // 80 → 240
	const after = (await editor.getBlock(0).boundingBox())!;

	// The header is on screen here, so content being pushed down is what should happen:
	// correcting for it would quietly scroll the user away from the top.
	expect(after.y - before.y).toBeCloseTo(160, 0);
	expect(await editor.editorContainer.evaluate((el) => el.scrollTop)).toBe(0);
	expect(pageErrors).toEqual([]);
});

test('scrollTo lands block 0 in view with a header mounted', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadLargeFixture('many-small-blocks', WINDOWED_BYTES);
	await progressiveScrollTo(editor, 4000);
	await expect(page.locator('.editor > .editor-header')).toHaveCount(1);

	expect(await page.evaluate(() => (window as any).__test.rects.scrollTo([0]))).toBe(true);

	const block = (await editor.getBlock(0).boundingBox())!;
	const port = (await editor.editorContainer.boundingBox())!;
	expect(block.y).toBeLessThan(port.y + port.height);
	expect(block.y + block.height).toBeGreaterThan(port.y);
	expect(pageErrors).toEqual([]);
});

test('a plain click on a link in the header follows it', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);

	// The app's own content is not document content, so the editor's rule about modifier-clicks
	// on links stops at the slot; without that exception the root handler would cancel this.
	await page.locator('[data-testid="hero-link"]').click();
	expect(await page.evaluate(() => location.hash)).toBe('#hero-link');
	expect(pageErrors).toEqual([]);
});

test('a text field in the header keeps its own Find chord', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);
	const focusedTestId = () =>
		page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

	// "Focus is inside the root" stopped meaning "focus is in this editor's content" the moment
	// the slot existed, so a text field of the app's keeps the shortcuts the editor reserves.
	await page.locator('[data-testid="hero-title"]').click();
	await page.keyboard.press('ControlOrMeta+f');
	await expect(page.locator('.search-bar')).toHaveCount(0);
	expect(await focusedTestId()).toBe('hero-title');

	// The control: the same field mounted outside the root already behaves this way, so the
	// check above is about the slot rather than about text fields in general.
	await page.locator('[data-testid="outside-title"]').click();
	await page.keyboard.press('ControlOrMeta+f');
	await expect(page.locator('.search-bar')).toHaveCount(0);
	expect(await focusedTestId()).toBe('outside-title');
	expect(pageErrors).toEqual([]);
});

test('a caret in the header is not reported as the document caret', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);
	const caretRect = () =>
		page.evaluate(() => (window as any).__test.rects.caretRect() as DOMRect | null);

	// A caret in a block does report, so the null below comes from the slot rather than from
	// there being no selection.
	await editor.focusBlockEnd(0);
	expect(await caretRect()).not.toBeNull();

	// The app's field puts a browser range inside the root, but `caretRect` is documented as
	// the document's caret; reporting it would float the app's own UI over its title.
	await page.locator('[data-testid="hero-note"]').click();
	expect(await caretRect()).toBeNull();
	expect(pageErrors).toEqual([]);
});

test('switching to reading mode leaves a focused header field focused', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);

	// Reading mode drops the editor's own caret; it has no business dropping the app's, which
	// switching mode would do in the middle of an edit.
	await page.locator('[data-testid="hero-title"]').click();
	await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));
	await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
	expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
		'hero-title'
	);
	expect(pageErrors).toEqual([]);
});

test('the find bar overlays the header at the top of the document', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);
	await editor.focusBlockEnd(0);
	await page.keyboard.press('ControlOrMeta+f');
	await expect(page.locator('.search-bar')).toHaveCount(1);

	// Accepted, and tested so it stays a decision: the bar sits at the editor's top edge in
	// both scroll modes, and at scrollTop 0 that edge is the header's.
	const bar = (await page.locator('.search-bar').boundingBox())!;
	const header = (await headerEl(page).boundingBox())!;
	expect(bar.y).toBeLessThan(header.y + header.height);
	expect(bar.y + bar.height).toBeGreaterThan(header.y);
	expect(pageErrors).toEqual([]);
});

// ── Host mode ───────────────────────────────────────────────────────────

const flowScrollTop = (page: Page): Promise<number> =>
	page.evaluate(
		() => (document.querySelector('[data-testid="scroller"]') as HTMLElement).scrollTop
	);

test('a host-mode header renders above the first block and never writes the ancestor scroll', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);
	const entry = page.locator('[data-testid="entry-header"]');
	await expect(entry.locator('.editor > .editor-header')).toHaveCount(1);

	const header = (await entry.locator('[data-testid="flow-header"]').boundingBox())!;
	const firstBlock = (await entry.locator(TOP_LEVEL_HOSTS).first().boundingBox())!;
	expect(firstBlock.y).toBeGreaterThanOrEqual(header.y + header.height - 1);

	// Left above the editor so the growth happens off screen below: the browser's own anchoring
	// has no reason to move, which leaves the editor writing the ancestor's scrollTop as the
	// only thing that could. Without the observer's exception for this mode it shifts by the
	// whole difference.
	await page.evaluate(() => {
		(document.querySelector('[data-testid="scroller"]') as HTMLElement).scrollTop = 1500;
	});
	await page.waitForTimeout(120);
	const before = await flowScrollTop(page);

	await page.locator('[data-testid="flow-header-toggle"]').click();
	await page.waitForTimeout(120); // one round of ResizeObserver callbacks

	// Proves something: the header really did grow, so "scrollTop unchanged" is about the
	// correction rather than about a toggle that did nothing.
	const grown = (await entry.locator('[data-testid="flow-header"]').boundingBox())!;
	expect(grown.height - header.height).toBeCloseTo(160, 0);
	expect(Math.abs((await flowScrollTop(page)) - before)).toBeLessThanOrEqual(1);
	expect(pageErrors).toEqual([]);
});

test('the host-mode find bar sits at the editor top edge, over the header', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);
	const entry = page.locator('[data-testid="entry-header"]');

	await entry.locator('[contenteditable]').first().click();
	await page.keyboard.press('ControlOrMeta+f');
	await expect(entry.locator('.search-bar')).toHaveCount(1);

	// For good, in this mode: the root never scrolls, so the bar never leaves the header.
	// Accepted rather than mounting the bar somewhere else depending on the mode.
	const bar = (await entry.locator('.search-bar').boundingBox())!;
	const header = (await entry.locator('[data-testid="flow-header"]').boundingBox())!;
	expect(bar.y).toBeLessThan(header.y + header.height);
	expect(bar.y + bar.height).toBeGreaterThan(header.y);
	expect(pageErrors).toEqual([]);
});

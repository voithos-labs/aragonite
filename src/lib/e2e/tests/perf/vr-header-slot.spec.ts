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

// The `header` slot: host chrome INSIDE the editor's scroll container, above the block
// list. Mounting it as a SIBLING of `.block-list` is what leaves the slice math untouched
// while the title still scrolls away. The live hazard is a slot that CHANGES height while
// the reader is scrolled deep, which routes through its own scroll compensation.

// Enough to window several screens deep without paying the headline gate's
// multi-MB load in every scroll case.
const WINDOWED_BYTES = 500_000;

const headerEl = (page: Page) => page.locator('[data-testid="harness-header"]');

async function gotoWithHeader(page: Page): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto('?header=on');
	return editor;
}

/** Click the page-header control (outside the scroll container) and let the header's
 *  resize reach the compensation observer. */
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

	// The no-prop arm first: without a header the root's markup is unchanged, so
	// the assertions below are about the slot, not about the fixture route.
	await editor.goto();
	await expect(page.locator('.editor-header')).toHaveCount(0);

	await editor.goto('?header=on');
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);

	// Sibling, never a wrapper: the windowing scope resolves its list as a DIRECT
	// child of the root (`:scope > .block-list`), which a wrapping header breaks.
	await expect(page.locator('.editor > .editor-header')).toHaveCount(1);
	await expect(page.locator('.editor > .block-list')).toHaveCount(1);
	await expect(page.locator('.editor-header .block-list')).toHaveCount(0);

	const header = (await headerEl(page).boundingBox())!;
	const firstBlock = (await editor.getBlock(0).boundingBox())!;
	expect(firstBlock.y).toBeGreaterThanOrEqual(header.y + header.height - 1);

	// Measured against the LIVE scrollTop, not the requested one: a post-load measure pass
	// can settle the estimate-based model a few dozen px off the request.
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
	// Bounded, not the no-header count: a header shrinks the list's slice of the
	// scrollport, so the window is legitimately a few blocks smaller.
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

	// Both the block's IDENTITY and its position: a compensation that overshot into
	// the next block would keep "some block" near the same offset.
	const before = await topVisibleHostTop(page, { selector: TOP_LEVEL_HOSTS });
	expect(before).not.toBeNull();
	expect(await headerEl(page).evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(
		80,
		0
	);

	await toggleHeaderHeight(editor); // 80 → 240
	expect(await headerEl(page).evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(
		240,
		0
	);
	const grown = await topVisibleHostTop(page, { selector: TOP_LEVEL_HOSTS });
	expect(grown!.ref).toBe(before!.ref);
	expect(Math.abs(grown!.top - before!.top)).toBeLessThanOrEqual(1);

	// The shrink arm: the same compensation runs with a negative delta.
	await toggleHeaderHeight(editor); // 240 → 80
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

	// The header is on screen here, so growth pushing content down IS the expected
	// reading — compensating would silently scroll the reader away from the top.
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

	// Host chrome is not document content, so the editor's modifier-click link policy stops
	// at the slot boundary; without that carve-out the root handler preventDefaults this.
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

	// "Focus is inside the root" stopped meaning "focus is in this editor's content" the
	// moment the slot existed, so the host's text entry keeps the reserved chords.
	await page.locator('[data-testid="hero-title"]').click();
	await page.keyboard.press('ControlOrMeta+f');
	await expect(page.locator('.search-bar')).toHaveCount(0);
	expect(await focusedTestId()).toBe('hero-title');

	// Control: the identical field mounted OUTSIDE the root already behaves this
	// way, so the assertion above is about the slot, not about fields at large.
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

	// A block caret reports, so the null below is the slot's doing, not an empty
	// selection.
	await editor.focusBlockEnd(0);
	expect(await caretRect()).not.toBeNull();

	// The host's field puts a native range inside the root, but `caretRect` is documented as
	// the DOCUMENT's caret — reporting it would float consumer chrome over the host title.
	await page.locator('[data-testid="hero-note"]').click();
	expect(await caretRect()).toBeNull();
	expect(pageErrors).toEqual([]);
});

test('switching to reading mode leaves a focused header field focused', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await gotoWithHeader(page);
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);

	// Reading mode drops the editor's own caret — it has no business dropping the
	// host's, which a mode toggle would do mid-edit.
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

	// Accepted, and pinned so it stays a decision: the bar rides the editor's top
	// edge in both scroll modes, and at scrollTop 0 that edge is the header's.
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

	// Parked ABOVE the entry so the growth is off-screen below: native scroll anchoring has
	// no reason to move, leaving the editor writing the ancestor's scrollTop as the only
	// thing that could. Reverting the observer's host-mode bail shifts it by the full delta.
	await page.evaluate(() => {
		(document.querySelector('[data-testid="scroller"]') as HTMLElement).scrollTop = 1500;
	});
	await page.waitForTimeout(120);
	const before = await flowScrollTop(page);

	await page.locator('[data-testid="flow-header-toggle"]').click();
	await page.waitForTimeout(120); // one ResizeObserver dispatch cycle

	// Vacuity guard: the header really did grow, so "scrollTop unchanged" is a
	// statement about the compensation, not about a toggle that did nothing.
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

	// Persistently, in this mode: the root never scrolls, so the bar never rides
	// off the header. Accepted over a second, mode-gated mount site for the bar.
	const bar = (await entry.locator('.search-bar').boundingBox())!;
	const header = (await entry.locator('[data-testid="flow-header"]').boundingBox())!;
	expect(bar.y).toBeLessThan(header.y + header.height);
	expect(bar.y + bar.height).toBeGreaterThan(header.y);
	expect(pageErrors).toEqual([]);
});

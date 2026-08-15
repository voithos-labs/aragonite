import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import {
	UNWINDOWED_ENTRY_BLOCKS,
	gotoPageScroll,
	scrollPageTo,
	spacerCount,
	topVisibleBlockInViewport
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Who holds the reader's place under late-sizing content in a page-scrolled host embedding.
// The two answers cannot coexist on one editor, so the activation decides: while windowing
// runs the editor corrects by hand and withdraws its subtree from the host's anchor
// candidates; below the budget it corrects nothing and stays a candidate. The oracle either
// way is the top block in the window viewport, before and after an image above it decodes.

const IMAGE_BLOCK = 6;
const DOCUMENT_IMAGE = '.editor .md-image-widget img';
const OUTER_IMAGE = '[data-testid="outer-image"]';

/** Puts every non-editor box out of the viewport: otherwise the document scroller could
 *  anchor on a filler and hold the line for a reason the editor had no part in. */
async function assertOnlyEntryContentInView(page: Page): Promise<void> {
	const intruders = await page.evaluate(() => {
		const ids = ['filler-top', 'filler-bottom', 'outer-image'];
		return ids.filter((id) => {
			const rect = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
			return rect.bottom > 0 && rect.top < window.innerHeight;
		});
	});
	expect(intruders).toEqual([]);
}

/** Park the reader just past the image block, so the grower sits above the fold and inside
 *  the mounted band — a windowed-out image never decodes and grows nothing. */
async function scrollPastImageBlock(page: Page): Promise<void> {
	const imageTop = await page.evaluate((i) => {
		const rect = (window as any).__test.rects.blockRect([i]) as DOMRect;
		return rect.top + window.scrollY;
	}, IMAGE_BLOCK);
	await scrollPageTo(page, Math.round(imageTop) + 150);
}

/** Wait for the image at `selector` to gain an intrinsic size, let the reflow
 *  settle, and report the height it took in layout. */
async function decodedHeight(page: Page, selector: string): Promise<number> {
	await page.waitForFunction(
		(sel) => ((document.querySelector(sel) as HTMLImageElement | null)?.naturalHeight ?? 0) > 0,
		selector
	);
	await page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
	return page.evaluate(
		(sel) => document.querySelector(sel)!.getBoundingClientRect().height,
		selector
	);
}

async function assertReaderHeld(page: Page, grow: () => Promise<void>): Promise<void> {
	await assertOnlyEntryContentInView(page);
	// Anchoring makes no adjustment at scroll offset 0, so a reader parked at the top
	// would pass this vacuously.
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	const before = await topVisibleBlockInViewport(page);
	expect(before).not.toBeNull();

	await grow();

	// Both the block's IDENTITY and its position: a document that scrolled by a whole
	// block would otherwise report "some block near the same offset".
	const after = await topVisibleBlockInViewport(page);
	expect(after!.ref).toBe(before!.ref);
	expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(1);
}

// The trade, as code rather than prose: one declaration, keyed on the activation, is what
// keeps native anchoring and the manual correction from both rewriting one scroll position.
test('the editor withdraws from host anchor candidacy only while windowing runs', async ({
	page
}) => {
	const anchorStyle = () =>
		page.evaluate(
			() => getComputedStyle(document.querySelector('.editor') as HTMLElement).overflowAnchor
		);

	await gotoPageScroll(page);
	expect(await spacerCount(page)).toBeGreaterThan(0);
	expect(await anchorStyle()).toBe('none');

	await gotoPageScroll(page, UNWINDOWED_ENTRY_BLOCKS);
	expect(await spacerCount(page)).toBe(0);
	expect(await anchorStyle()).toBe('auto');
});

test('a document image decoding in above the fold does not shift the windowed reader', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);
	await scrollPastImageBlock(page);
	expect(await spacerCount(page)).toBeGreaterThan(0);

	await assertReaderHeld(page, async () => {
		await page.evaluate(() => (window as any).__pageScroll.loadDocumentImage());
		// Vacuity: the content above the reader really did grow.
		expect(await decodedHeight(page, DOCUMENT_IMAGE)).toBeCloseTo(300, 0);
	});
	expect(pageErrors).toEqual([]);
});

// Below the budget nothing corrects by hand, so the host's own anchoring must still be able
// to see the editor's blocks. A red here means the opt-out was applied unconditionally.
test('a document image decoding in above the fold does not shift an unwindowed reader', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page, UNWINDOWED_ENTRY_BLOCKS);
	await scrollPastImageBlock(page);
	expect(await spacerCount(page)).toBe(0);

	await assertReaderHeld(page, async () => {
		await page.evaluate(() => (window as any).__pageScroll.loadDocumentImage());
		expect(await decodedHeight(page, DOCUMENT_IMAGE)).toBeCloseTo(300, 0);
	});
	expect(pageErrors).toEqual([]);
});

// A held reveal claim re-asserts its target's absolute position on every measure pass. Below
// the budget the browser is already holding that same line, so the re-assertion is the second
// writer — the same shape as the correction itself, on the one path that outranks it.
test('a held reveal claim does not double-correct against native anchoring', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page, UNWINDOWED_ENTRY_BLOCKS);
	expect(await spacerCount(page)).toBe(0);

	// `'nearest'` holds its pin by default, and no user gesture follows to release it.
	const target = Math.round(UNWINDOWED_ENTRY_BLOCKS / 2);
	expect(await page.evaluate((i) => (window as any).__test.rects.scrollTo([i]), target)).toBe(true);

	await assertReaderHeld(page, async () => {
		await page.evaluate(() => (window as any).__pageScroll.loadDocumentImage());
		expect(await decodedHeight(page, DOCUMENT_IMAGE)).toBeCloseTo(300, 0);
	});
	expect(pageErrors).toEqual([]);
});

test('an image decoding in outside an unwindowed entry does not shift the reader', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page, UNWINDOWED_ENTRY_BLOCKS);
	await scrollPastImageBlock(page);

	// The attribution arm: identical growth one box further out, where the host's own wrapper
	// anchors. A red here means the page has no scroll anchoring at all, which would make the
	// arm above red for the wrong reason.
	await assertReaderHeld(page, async () => {
		await page.evaluate(() => (window as any).__pageScroll.loadOuterImage());
		expect(await decodedHeight(page, OUTER_IMAGE)).toBeCloseTo(300, 0);
	});
	expect(pageErrors).toEqual([]);
});

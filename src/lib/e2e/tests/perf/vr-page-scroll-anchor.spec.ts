import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { gotoPageScroll, scrollPageTo, topVisibleBlockInViewport } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Scroll anchoring in a page-scrolled host embedding. Self mode turns native anchoring off
// because windowing corrects by hand; host mode has no manual correction, so holding the
// reader's place is the browser's call — and it can only make it if the editor's blocks are
// anchor candidates. The oracle is the top block in the window viewport, before and after an
// image above the fold decodes; where that image sits is the whole subject.

const READING_OFFSET = 2000;

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

const DOCUMENT_IMAGE = '.editor .md-image-widget img';
const OUTER_IMAGE = '[data-testid="outer-image"]';

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

test('a document image decoding in above the fold does not shift the reader', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);
	await scrollPageTo(page, READING_OFFSET);
	await assertOnlyEntryContentInView(page);

	// Anchoring makes no adjustment at scroll offset 0, so a reader parked at the top
	// would pass this vacuously.
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	const before = await topVisibleBlockInViewport(page);
	expect(before).not.toBeNull();

	await page.evaluate(() => (window as any).__pageScroll.loadDocumentImage());
	// Vacuity: the content above the reader really did grow.
	expect(await decodedHeight(page, DOCUMENT_IMAGE)).toBeCloseTo(300, 0);

	// Both the block's IDENTITY and its position: a document that scrolled by a whole
	// block would otherwise report "some block near the same offset".
	const after = await topVisibleBlockInViewport(page);
	expect(after!.ref).toBe(before!.ref);
	expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(1);
	expect(pageErrors).toEqual([]);
});

test('an image decoding in outside the entry does not shift the reader', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);
	await scrollPageTo(page, READING_OFFSET);
	await assertOnlyEntryContentInView(page);

	const before = await topVisibleBlockInViewport(page);
	expect(before).not.toBeNull();

	// The attribution arm: identical growth one box further out, where the host's wrapper
	// anchors. A red here means the page has no scroll anchoring at all.
	await page.evaluate(() => (window as any).__pageScroll.loadOuterImage());
	expect(await decodedHeight(page, OUTER_IMAGE)).toBeCloseTo(300, 0);

	const after = await topVisibleBlockInViewport(page);
	expect(after!.ref).toBe(before!.ref);
	expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(1);
	expect(pageErrors).toEqual([]);
});

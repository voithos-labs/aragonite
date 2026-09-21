import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import {
	UNWINDOWED_ENTRY_BLOCKS,
	gotoPageScroll,
	settleFrames,
	scrollPageTo,
	spacerCount,
	topVisibleBlockInViewport
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Who keeps the reader's place when content above them grows late, in a page that does the
// scrolling. The two answers cannot both apply to one editor, so whether windowing is running
// decides: while it runs the editor corrects the scroll itself and takes its blocks out of the
// browser's own anchoring; below the threshold it corrects nothing and stays eligible. Either
// way the check is the top block in the viewport, before and after an image above it decodes.

const IMAGE_BLOCK = 6;
const DOCUMENT_IMAGE = '.editor .md-image-widget img';
const OUTER_IMAGE = '[data-testid="outer-image"]';

/** Moves everything that is not the editor out of the viewport: otherwise the page could
 *  anchor on filler and hold the position for a reason the editor had no part in. */
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

/** Leave the reader just past the image, so it sits above the viewport and among the mounted
 *  blocks: an image that is unmounted never decodes and never grows. */
async function scrollPastImageBlock(page: Page): Promise<void> {
	const imageTop = await page.evaluate((i) => {
		const rect = (window as any).__test.rects.blockRect([i]) as DOMRect;
		return rect.top + window.scrollY;
	}, IMAGE_BLOCK);
	await scrollPageTo(page, Math.round(imageTop) + 150);
}

/** Wait for the image at `selector` to get its own size, let the reflow settle, and report
 *  the height it ended up with. */
async function decodedHeight(page: Page, selector: string): Promise<number> {
	await page.waitForFunction(
		(sel) => ((document.querySelector(sel) as HTMLImageElement | null)?.naturalHeight ?? 0) > 0,
		selector
	);
	await settleFrames(page);
	return page.evaluate(
		(sel) => document.querySelector(sel)!.getBoundingClientRect().height,
		selector
	);
}

async function assertReaderHeld(page: Page, grow: () => Promise<void>): Promise<void> {
	await assertOnlyEntryContentInView(page);
	// Nothing is adjusted at scroll position 0, so a reader at the top would pass this
	// without proving anything.
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	const before = await topVisibleBlockInViewport(page);
	expect(before).not.toBeNull();

	await grow();

	// Both which block it is and where it sits: a document that scrolled by a whole block
	// would otherwise report "some block at about the same place".
	const after = await topVisibleBlockInViewport(page);
	expect(after!.ref).toBe(before!.ref);
	expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(1);
}

// The trade-off in code rather than prose: one declaration, switched on whether windowing is
// running, is what stops the browser's anchoring and the editor's correction both writing the
// same scroll position.
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
		// Proves something: the content above the reader really did grow.
		expect(await decodedHeight(page, DOCUMENT_IMAGE)).toBeCloseTo(300, 0);
	});
	expect(pageErrors).toEqual([]);
});

// Below the threshold the editor corrects nothing, so the browser's own anchoring must still
// see its blocks. A failure here means the opt-out was applied in every case.
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

// A held scroll-to request re-asserts its target's exact position on every measure pass. Below
// the threshold the browser is already holding that same position, so the re-assertion is a
// second writer, the same problem as the correction itself on the one path that outranks it.
test('a held reveal claim does not double-correct against native anchoring', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page, UNWINDOWED_ENTRY_BLOCKS);
	expect(await spacerCount(page)).toBe(0);

	// `'nearest'` keeps holding the position by default, and no gesture follows to release it.
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

	// The control: the same growth one box further out, where the page's own wrapper anchors. A
	// failure here means the page has no scroll anchoring at all, which would fail the case
	// above for the wrong reason.
	await assertReaderHeld(page, async () => {
		await page.evaluate(() => (window as any).__pageScroll.loadOuterImage());
		expect(await decodedHeight(page, OUTER_IMAGE)).toBeCloseTo(300, 0);
	});
	expect(pageErrors).toEqual([]);
});

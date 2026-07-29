import { test, expect } from '../../fixtures';
import { cstBlockCount, gotoPageScroll, scrollPageTo, spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// The page-scrolled host embedding: `scrollMode="host"` with nothing scrollable
// between the editor and the document, so the window's own viewport is the
// scrollport. `/test/flow` covers the other host shape (an ancestor scroller) and
// pins its page at 100vh, which left this one — the journal shell that scrolls with
// the page — without a route to assert against.

const TOP_LEVEL_HOSTS = '[data-block-path]:not([data-block-path*=","])';

test('the document owns the scroll and nothing between it and the editor does', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	const geometry = await page.evaluate(() => {
		const root = document.querySelector('.editor') as HTMLElement;
		const scrollable: string[] = [];
		for (let cur = root.parentElement; cur && cur !== document.body; cur = cur.parentElement) {
			const cs = getComputedStyle(cur);
			if (['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)) {
				scrollable.push(cur.className);
			}
		}
		const doc = document.scrollingElement as HTMLElement;
		return {
			scrollable,
			rootOverflowY: getComputedStyle(root).overflowY,
			rootOverflowPx: root.scrollHeight - root.clientHeight,
			rootHeight: root.getBoundingClientRect().height,
			pageScrollHeight: doc.scrollHeight,
			pageOverflowPx: doc.scrollHeight - doc.clientHeight
		};
	});
	// The crux of the shape: the user-scrollable walk finds no answer above the
	// editor, so every seam that asks "what scrolls" has to fall through to the
	// window rather than to an element.
	expect(geometry.scrollable).toEqual([]);
	expect(geometry.rootOverflowY).toBe('visible');
	expect(geometry.rootOverflowPx).toBeLessThanOrEqual(1);
	expect(geometry.rootHeight).toBeGreaterThan(3000);
	// The entry's full height is in the PAGE's flow, and the page is what overflows.
	expect(geometry.pageScrollHeight).toBeGreaterThan(geometry.rootHeight);
	expect(geometry.pageOverflowPx).toBeGreaterThan(2000);

	const blockTop = () =>
		page.evaluate(
			() => document.querySelector('.editor [data-block-path="[0]"]')!.getBoundingClientRect().top
		);
	const before = await blockTop();
	await scrollPageTo(page, 1500);
	expect(before - (await blockTop())).toBeGreaterThan(1400);
	expect(pageErrors).toEqual([]);
});

test('windowing never activates, so every block stays mounted', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	// Host mode disables windowing statically — the height model would read the
	// editor root's clientHeight as its viewport (the whole entry, since the root
	// no longer scrolls) and a local scrollTop of 0, and mount everything anyway.
	const count = await cstBlockCount(page);
	expect(count).toBeGreaterThan(100);
	await expect(page.locator(`.editor ${TOP_LEVEL_HOSTS}`)).toHaveCount(count);
	expect(await spacerCount(page)).toBe(0);
	expect(pageErrors).toEqual([]);
});

test('scrollTo on a far block scrolls the page and lands it in the viewport', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	expect(await page.evaluate(() => (window as any).__test.rects.scrollTo([140]))).toBe(true);
	const seen = await page.evaluate(() => {
		const rect = (window as any).__test.rects.blockRect([140]) as DOMRect;
		return {
			top: rect.top,
			bottom: rect.bottom,
			viewport: window.innerHeight,
			scrollY: window.scrollY
		};
	});
	expect(seen.scrollY).toBeGreaterThan(0);
	expect(seen.top).toBeLessThan(seen.viewport);
	expect(seen.bottom).toBeGreaterThan(0);
	expect(pageErrors).toEqual([]);
});

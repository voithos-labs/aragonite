import { test, expect } from '../../fixtures';
import {
	TOP_LEVEL_HOSTS,
	UNWINDOWED_ENTRY_BLOCKS,
	cstBlockCount,
	gotoPageScroll,
	mountedTopLevelCount,
	scrollPageTo,
	spacerCount,
	topVisibleBlockInViewport
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// The page-scrolled host embedding: `scrollMode="host"` with nothing scrollable between the
// editor and the document, so the window's own viewport is the scrollport. `/test/flow`
// covers the other host shape (an ancestor scroller) and pins its page at 100vh.

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
	// The point of this layout: the walk for a scrollable ancestor finds nothing above the
	// editor, so everything that asks what scrolls has to end up at the window, not an element.
	expect(geometry.scrollable).toEqual([]);
	expect(geometry.rootOverflowY).toBe('visible');
	expect(geometry.rootOverflowPx).toBeLessThanOrEqual(1);
	// Spacers stand in for the unmounted blocks, so the editor's box is still the height of the
	// whole document and the page is what overflows.
	expect(geometry.rootHeight).toBeGreaterThan(3000);
	expect(geometry.pageScrollHeight).toBeGreaterThan(geometry.rootHeight);
	expect(geometry.pageOverflowPx).toBeGreaterThan(2000);
	expect(pageErrors).toEqual([]);
});

test('windowing activates past the budget and bounds the mounted set', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	// What changed: an editor in a scrolling page windows once it is over the threshold, where
	// it used to mount whole because this mode turned windowing off.
	const count = await cstBlockCount(page);
	expect(count).toBeGreaterThan(100);
	expect(await mountedTopLevelCount(page)).toBeLessThan(count);
	expect(await spacerCount(page)).toBeGreaterThan(0);
	expect(pageErrors).toEqual([]);
});

test('scrolling the page moves the window over the document', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	const mountedIndices = () =>
		page.evaluate(
			(sel) =>
				Array.from(document.querySelectorAll(`.editor ${sel}`)).map(
					(el) => JSON.parse(el.getAttribute('data-block-path')!)[0] as number
				),
			TOP_LEVEL_HOSTS
		);

	const atTop = await mountedIndices();
	expect(atTop[0]).toBe(0);

	await scrollPageTo(page, 4000);
	const deep = await mountedIndices();

	// A page scroll the height table never heard about would leave the same blocks mounted.
	expect(deep[0]).toBeGreaterThan(atTop[atTop.length - 1]);
	expect(deep).toEqual(deep.map((_, i) => deep[0] + i));
	// Still bounded: the mounted blocks follow the viewport rather than piling up behind it.
	expect(deep.length).toBeLessThan(atTop.length * 3);
	expect(pageErrors).toEqual([]);
});

test('a document under the budget never activates and renders whole', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page, UNWINDOWED_ENTRY_BLOCKS);

	// The threshold is the only condition, so a small embedded document pays nothing for this.
	const count = await cstBlockCount(page);
	expect(count).toBe(UNWINDOWED_ENTRY_BLOCKS);
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

// #72: where the editor puts a caret below the document and where an app's own handler puts
// one, working from the parsed document, agreed only while this mode never windowed. They must
// still name the same block.
test('a point below the whole document lands at the document end, not the mounted tail', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	const lastIndex = (await cstBlockCount(page)) - 1;
	// A point past the editor's own box, where a shell's below-the-editor handler sends one.
	const claimed = await page.evaluate(() => {
		const root = document.querySelector('.editor') as HTMLElement;
		const rect = root.getBoundingClientRect();
		return (window as any).__test.placeCaretAtPoint(rect.left + 20, rect.bottom + 200);
	});
	expect(claimed).toBe(true);

	await expect
		.poll(() =>
			page.evaluate(() => (window as any).__test.getSelectionPaths()?.focus.path[0] ?? null)
		)
		.toBe(lastIndex);
	// The landing revealed its target rather than reporting a caret in an unmounted block.
	expect(
		await page.evaluate((i) => (window as any).__test.rects.blockRect([i]) !== null, lastIndex)
	).toBe(true);
	expect(pageErrors).toEqual([]);
});

test('a search jump reveals its match and scrolls the page to it', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	// Unique to one far block, and windowed out while the reader sits at the top.
	const match = page.locator('.editor [data-block-path="[147]"]');
	await expect(match).toHaveCount(0);

	await page.locator('.editor [data-block-path="[0]"] [contenteditable]').first().click();
	await page.keyboard.press('ControlOrMeta+f');
	const find = page.getByRole('textbox', { name: 'Find' });
	await find.waitFor({ state: 'visible' });
	await page.keyboard.type('Paragraph 147 ');

	// The jump brings its target into view: the match's block mounts and the page scrolls to
	// it. That takes several passes, so this polls rather than reading the first frame.
	await expect(match).toHaveCount(1);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const rect = (window as any).__test.rects.blockRect([147]) as DOMRect | null;
				return rect !== null && rect.top < window.innerHeight && rect.bottom > 0;
			})
		)
		.toBe(true);
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	expect(pageErrors).toEqual([]);
});

test('a windowed-out undo target is revealed before the caret lands', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	// Type into a block near the top, then scroll far past it so its host unmounts.
	await page.locator('.editor [data-block-path="[2]"] [contenteditable]').first().click();
	await page.keyboard.type('EDITED');
	await scrollPageTo(page, 5000);
	await expect(page.locator('.editor [data-block-path="[2]"]')).toHaveCount(0);

	await page.keyboard.press('ControlOrMeta+z');

	// Mount first, then act: undo mounts its target and puts the caret in it.
	await expect(page.locator('.editor [data-block-path="[2]"]')).toHaveCount(1);
	const top = await topVisibleBlockInViewport(page);
	expect(top!.ref).toBe('[2]');
	expect(await page.evaluate(() => (window as any).__test.getSource())).not.toContain('EDITED');
	expect(pageErrors).toEqual([]);
});

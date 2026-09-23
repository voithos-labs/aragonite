import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import {
	FIXTURE_BYTES,
	MAX_UNMOUNTED_EDGE_FRACTION,
	TOP_LEVEL_HOSTS,
	cstBlockCount,
	mountedViewportSpan,
	spacerCount
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Windowing limits how many blocks are mounted: a document whose estimated height passes the
// activation threshold mounts only a window of them, plus spacers, while a small document
// renders every block with no spacers. Covers flat documents and the cases of one huge
// blockquote, list or table.

function mountedBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.perf.snapshot().mountedBlockCount);
}

/** Every ceiling below pairs with this: a ceiling alone is met by mounting nothing, so only
 *  how far the mounted blocks reach shows they cover what the user can see. */
async function expectMountedBandSpansViewport(page: Page, selector: string): Promise<void> {
	const span = await mountedViewportSpan(page, selector);
	expect(span.topGapPx).toBeLessThan(span.viewportHeight * MAX_UNMOUNTED_EDGE_FRACTION);
	expect(span.bottomGapPx).toBeLessThan(span.viewportHeight * MAX_UNMOUNTED_EDGE_FRACTION);
}

// Every mounted block host, nested ones included. getDomBlockCount counts only top-level
// hosts, so for one huge container it would read about 1 whether the container windows or not,
// which proves nothing.
function allHostCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('[data-block-path]').length);
}

/** Counts every block host added to the editor from now on, including any mounted and torn
 *  down within one flush, which the settled DOM and the mount balance both hide. */
async function startCountingHostMounts(page: Page): Promise<() => Promise<number>> {
	await page.evaluate(() => {
		const w = window as any;
		w.__hostMounts = 0;
		w.__countHostMounts = (records: MutationRecord[]) => {
			for (const record of records)
				for (const added of record.addedNodes)
					if (added instanceof Element && added.matches('[data-block-path]')) w.__hostMounts++;
		};
		w.__hostMountObserver = new MutationObserver(w.__countHostMounts);
		w.__hostMountObserver.observe(document.querySelector('.editor')!, {
			childList: true,
			subtree: true
		});
	});
	return () =>
		page.evaluate(() => {
			const w = window as any;
			w.__countHostMounts(w.__hostMountObserver.takeRecords());
			w.__hostMountObserver.disconnect();
			return w.__hostMounts as number;
		});
}

test('windowing bounds the mounted set on a multi-thousand-block doc', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	// This test's first action after navigating is a load with a 2s timeout, not the 90s wait
	// its neighbours use, and on a busy machine it can fire mid-navigation and abort.
	await page.waitForURL(/\/test\/editor/);

	// Reset to a one-block document before turning the counters on: otherwise the running total
	// includes the showcase mounted while they were off, and reads too low by that much.
	await editor.loadContent('baseline\n');
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});

	// The one-block document's window is inactive and sized for one block; the swap must not
	// read that as "mount everything" for the pass before the window catches up.
	const hostMountsDuringSwap = await startCountingHostMounts(page);
	const blockCount = await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);
	const mountedDuringSwap = await hostMountsDuringSwap();

	// `many-small-blocks` is flat, with no nested hosts, so counting top-level blocks in the
	// DOM gives exactly the mounted window and the bound is unambiguous.
	const domMounted = await editor.getDomBlockCount();
	const balance = await mountedBlockCount(page);

	console.log(
		`VR headline ${JSON.stringify({ blockCount, domMounted, balance, mountedDuringSwap })}`
	);

	expect(blockCount).toBeGreaterThan(2000);
	expect(domMounted).toBeLessThan(60);
	expect(domMounted).toBeLessThan(blockCount / 10);
	expect(mountedDuringSwap).toBeLessThan(2 * domMounted);
	// Check the counter against the live count; they should agree to within the one block the
	// total was reset on.
	expect(Math.abs(balance - domMounted)).toBeLessThanOrEqual(2);
	await expectMountedBandSpansViewport(page, TOP_LEVEL_HOSTS);
	// Without this, a throw during render (state_unsafe_mutation) would pass unnoticed.
	expect(pageErrors).toEqual([]);
});

// The first part of the VR-8 fix. The blank gap itself cannot be produced from a test, since a
// scroll driven on the main thread mounts the new blocks before paint, so this covers the fix
// instead: the spacer's placeholder tint, from the editor.css rule and the --vr-spacer-bg token.
test('windowed spacers carry a placeholder background (VR-8 skeleton)', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);

	expect(await spacerCount(page)).toBeGreaterThan(0);

	const alpha = await page.evaluate(() => {
		const spacer = document.querySelector('.vr-spacer');
		if (!spacer) return null;
		const bg = getComputedStyle(spacer).backgroundColor;
		const m = bg.match(/rgba?\(([^)]+)\)/);
		if (!m) return null;
		const parts = m[1].split(',').map((p) => parseFloat(p));
		return parts.length === 4 ? parts[3] : 1;
	});

	expect(alpha).not.toBeNull();
	expect(alpha!).toBeGreaterThan(0);
});

test('mounted set stays bounded as document size grows (O(viewport), not O(doc))', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// `many-small-blocks` is flat, so counting top-level blocks in the DOM gives the mounted
	// window directly, with no need to reset the counters between loads.
	const cstSmall = await editor.loadLargeFixture('many-small-blocks', 500_000);
	const mountedSmall = await editor.getDomBlockCount();
	const cstBig = await editor.loadLargeFixture('many-small-blocks', 1_500_000);
	const mountedBig = await editor.getDomBlockCount();

	console.log(
		`VR size-independence ${JSON.stringify({ cstSmall, mountedSmall, cstBig, mountedBig })}`
	);

	// The larger document must hold far more blocks, or "it does not depend on size" proves
	// nothing, since two similar documents would also mount similar numbers.
	expect(cstBig).toBeGreaterThan(cstSmall * 2);

	// Both windows are small and nearly equal: a regression where the number mounted grew with
	// the document fails here.
	expect(mountedSmall).toBeLessThan(60);
	expect(mountedBig).toBeLessThan(60);
	expect(Math.abs(mountedBig - mountedSmall)).toBeLessThanOrEqual(10);
	await expectMountedBandSpansViewport(page, TOP_LEVEL_HOSTS);

	expect(pageErrors).toEqual([]);
});

test('a small document renders fully with no windowing', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('# Hi\n\nWorld.\n');

	expect(await spacerCount(page)).toBe(0);
	expect(await editor.getDomBlockCount()).toBe(await editor.bridge.getBlockCount());
	expect(pageErrors).toEqual([]);
});

test('giant single blockquote windows its children (phase 3 spike)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-blockquote', 2_000_000);

	// One top-level blockquote with thousands of paragraphs inside it: without checking that
	// count, the limit of 150 mounted below proves nothing.
	expect(await cstBlockCount(page)).toBe(1);
	expect(
		await page.evaluate(() => (window as any).__test.getDocument().children[0].children.length)
	).toBeGreaterThan(2000);

	// Spacers inside the blockquote: the document has one child, so it produces none itself and
	// every spacer comes from inside.
	expect(await spacerCount(page, '.blockquote-block')).toBeGreaterThan(0);

	// Mounted blocks, top-level and nested, limited by the viewport plus what is kept around it
	// rather than by the paragraph count. getDomBlockCount leaves out nested blocks, so this
	// counts every path.
	expect(await allHostCount(page)).toBeLessThan(150);
	await expectMountedBandSpansViewport(page, '[data-block-path]');

	// Without this, a throw while rendering the windowed list would pass unnoticed.
	expect(pageErrors).toEqual([]);
});

test('giant single list windows its items (phase 3)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-list', 2_000_000);

	// One top-level list with thousands of items: without checking that count, the limit of
	// 200 mounted below proves nothing.
	const doc = await page.evaluate(() => (window as any).__test.getDocument());
	expect(doc.children.length).toBe(1);
	expect(doc.children[0].children.length).toBeGreaterThan(2000);

	// Windowed inside the list itself: the spacers come from the list, since the document has
	// one child and produces none.
	expect(await spacerCount(page, '.list-block >')).toBeGreaterThan(0);

	// Mounted blocks, top-level and nested, limited by the viewport plus what is kept around
	// it rather than by the item count.
	expect(await allHostCount(page)).toBeLessThan(200);
	await expectMountedBandSpansViewport(page, '[data-block-path]');

	expect(pageErrors).toEqual([]);
});

test('giant single table windows its rows (phase 4)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	// One top-level table with thousands of rows: without checking that count, the limit
	// below proves nothing.
	const doc = await page.evaluate(() => (window as any).__test.getDocument());
	expect(doc.children.length).toBe(1);
	expect(doc.children[0].children.length).toBeGreaterThan(2000);

	// Spacers inside the table itself, since the document has one child and produces none.
	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);

	// Mounted rows limited by the viewport plus what is kept around it, not by the row count.
	expect(
		await page.evaluate(() => document.querySelectorAll('[data-table-row-idx]').length)
	).toBeLessThan(120);
	// Cells, not rows: a `display: contents` row has no box to span anything with.
	await expectMountedBandSpansViewport(page, '[data-table-row-idx] > .table-cell');

	// Removing the spacers' `grid-column: 1 / -1` moves cells one column along and splits a row
	// across two lines. Checked on the shared top rather than the width, which would survive it.
	const band = await page.evaluate(() => {
		const table = document.querySelector('.table-block') as HTMLElement;
		const row = document.querySelector('[data-table-row-idx]') as HTMLElement | null;
		const cells = Array.from(row?.querySelectorAll(':scope > .table-cell') ?? []) as HTMLElement[];
		if (cells.length < 2) return null;
		const tops = cells.map((c) => c.getBoundingClientRect().top);
		const tableRect = table.getBoundingClientRect();
		const lefts = cells.map((c) => c.getBoundingClientRect().left);
		const rights = cells.map((c) => c.getBoundingClientRect().right);
		return {
			topSpread: Math.max(...tops) - Math.min(...tops),
			leftGap: Math.min(...lefts) - tableRect.left,
			rightGap: tableRect.right - Math.max(...rights)
		};
	});
	expect(band).not.toBeNull();
	expect(band!.topSpread).toBeLessThan(4);
	expect(band!.leftGap).toBeLessThan(4);
	expect(band!.rightGap).toBeLessThan(4);

	// Without this, a throw during render (effect_update_depth_exceeded) would pass unnoticed.
	expect(pageErrors).toEqual([]);
});

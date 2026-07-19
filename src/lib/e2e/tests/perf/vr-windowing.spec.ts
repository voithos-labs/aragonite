import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors, FIXTURE_BYTES, cstBlockCount, spacerCount } from './vr-helpers';

// Windowing bounds the mounted set: a doc whose estimated height clears the
// activation watermark mounts only a window of blocks (plus spacers); a small doc
// renders every block with no spacers. Covers flat docs and the giant single
// blockquote / list / table container cases.

function mountedBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.perf.snapshot().mountedBlockCount);
}

// Total mounted BlockHosts, INCLUDING nested (comma-path) hosts. getDomBlockCount
// counts top-level hosts only, so for a single giant container it would read ~1
// whether or not the container windows — useless as a windowing assertion.
function allHostCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('[data-block-path]').length);
}

test('windowing bounds the mounted set on a multi-thousand-block doc', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	// Settle the route navigation before the baseline `setSource`. Unlike the
	// neighbours that go straight to `loadLargeFixture` (whose 90s probe rides out
	// a still-committing nav), this test's first post-goto interaction is the
	// 2s-timeout baseline load — under CPU contention it can fire mid-navigation
	// and abort with "navigated to /test/editor".
	await page.waitForURL(/\/test\/editor/);

	// The running mounted-block balance is polluted by the showcase mounted
	// before perf was armed. Reset to a known 1-block baseline and settle, THEN
	// enable+reset, so post-load the balance reflects the window (≈ census), not
	// window minus showcase.
	await editor.loadContent('baseline\n');
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});

	const blockCount = await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);

	// `many-small-blocks` is flat (no nested hosts), so the top-level DOM census
	// equals the mounted window and the bound is unambiguous.
	const domMounted = await editor.getDomBlockCount();
	const balance = await mountedBlockCount(page);

	console.log(`VR headline ${JSON.stringify({ blockCount, domMounted, balance })}`);

	expect(blockCount).toBeGreaterThan(2000);
	expect(domMounted).toBeLessThan(60);
	expect(domMounted).toBeLessThan(blockCount / 10);
	// Cross-check the gauge against the live census; they should agree within the
	// 1-block baseline the balance was reset on.
	expect(Math.abs(balance - domMounted)).toBeLessThanOrEqual(2);
	// Heaviest windowed reconcile path — a render-phase throw (e.g. a
	// state_unsafe_mutation) must fail the test, not pass silently green.
	expect(pageErrors).toEqual([]);
});

// VR-8 mitigation #1 (skeleton background). A real compositor fling can outrun the
// window recompute and paint a bare spacer for one frame; the blank-gap itself is
// not harness-drivable (a main-thread scroll driver flushes the new slice before
// paint), so this guards the MITIGATION — the spacer carries a non-transparent
// placeholder tint — not the unreachable gap. Removing the editor.css rule or the
// --vr-spacer-bg token drops the alpha to 0 and fails this.
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

	// `many-small-blocks` is flat, so the top-level DOM census IS the mounted
	// window — no perf-gauge reset dance needed between loads. Two modest sizes
	// that both clearly activate windowing.
	const cstSmall = await editor.loadLargeFixture('many-small-blocks', 500_000);
	const mountedSmall = await editor.getDomBlockCount();
	const cstBig = await editor.loadLargeFixture('many-small-blocks', 1_500_000);
	const mountedBig = await editor.getDomBlockCount();

	console.log(
		`VR size-independence ${JSON.stringify({ cstSmall, mountedSmall, cstBig, mountedBig })}`
	);

	// The bigger doc must have far more CST blocks — otherwise "size-independent"
	// is vacuous (two similar docs would also mount similarly).
	expect(cstBig).toBeGreaterThan(cstSmall * 2);

	// Both windows are small in absolute terms AND nearly equal: a regression
	// where mounting scaled with doc size (bigger doc → more mounted) fails here.
	expect(mountedSmall).toBeLessThan(60);
	expect(mountedBig).toBeLessThan(60);
	expect(Math.abs(mountedBig - mountedSmall)).toBeLessThanOrEqual(10);

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

	// ONE top-level blockquote with thousands of paragraph children — without the
	// child count the < 150 mounted bound below proves nothing.
	expect(await cstBlockCount(page)).toBe(1);
	expect(
		await page.evaluate(() => (window as any).__test.getDocument().children[0].children.length)
	).toBeGreaterThan(2000);

	// Spacers inside the blockquote (the top scope has one child, so it emits none —
	// every spacer comes from the nested scope).
	expect(
		await page.evaluate(() => document.querySelectorAll('.blockquote-block .vr-spacer').length)
	).toBeGreaterThan(0);

	// Mounted hosts (top-level + nested) bounded to viewport+overscan+pin, NOT the
	// paragraph count. getDomBlockCount excludes nested hosts, so census all paths.
	expect(await allHostCount(page)).toBeLessThan(150);

	// A render-phase throw (e.g. state_unsafe_mutation in the windowed reconcile)
	// must fail, not pass green.
	expect(pageErrors).toEqual([]);
});

test('giant single list windows its items (phase 3)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-list', 2_000_000);

	// ONE top-level list with thousands of items — without the child count the
	// < 200 mounted bound below proves nothing.
	const doc = await page.evaluate(() => (window as any).__test.getDocument());
	expect(doc.children.length).toBe(1);
	expect(doc.children[0].children.length).toBeGreaterThan(2000);

	// Windowed INSIDE the list itself — spacers come from the .list-block scope
	// (the top scope has one child, so it emits none).
	expect(
		await page.evaluate(() => document.querySelectorAll('.list-block > .vr-spacer').length)
	).toBeGreaterThan(0);

	// Mounted hosts (top-level + nested) bounded to viewport+overscan+pin, NOT the
	// item count.
	expect(await allHostCount(page)).toBeLessThan(200);

	expect(pageErrors).toEqual([]);
});

test('giant single table windows its rows (phase 4)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	// ONE top-level table with thousands of rows — without the row count the
	// bound below proves nothing.
	const doc = await page.evaluate(() => (window as any).__test.getDocument());
	expect(doc.children.length).toBe(1);
	expect(doc.children[0].children.length).toBeGreaterThan(2000);

	// Spacers INSIDE the table grid (the top scope has one child, so it emits none).
	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);

	// Mounted rows bounded to viewport + overscan + pin, NOT the row count.
	expect(
		await page.evaluate(() => document.querySelectorAll('[data-table-row-idx]').length)
	).toBeLessThan(120);

	// Grid still lays out: a mounted row's cells form ONE horizontal band (shared
	// top) spanning the table width. Deleting the spacers' `grid-column: 1 / -1`
	// shifts the cells one grid track, splitting a row across two row bands — the
	// shared-top assertion (not a width check, which survives the shift) catches it.
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

	// A render-phase throw (e.g. state_unsafe_mutation / effect_update_depth_exceeded)
	// must fail the test, not pass silently green.
	expect(pageErrors).toEqual([]);
});

import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// First suite to ACTIVATE windowing: every fixture here clears the editor's
// height watermark, so only a window of top-level blocks mounts and the
// off-window reveal path runs for real. Honest assertions only — a reveal that
// doesn't land the caret is a VR bug to report, not an assertion to soften.

const FIXTURE_BYTES = 2_000_000;

function cstBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.getDocument().children.length);
}

function mountedBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.perf.snapshot().mountedBlockCount);
}

function spacerCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('.vr-spacer').length);
}

// Total mounted BlockHosts, INCLUDING nested (comma-path) hosts. getDomBlockCount
// counts top-level hosts only, so for a single giant container it would read ~1
// whether or not the container windows — useless as a windowing assertion.
function allHostCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('[data-block-path]').length);
}

function topLevelHostPresent(page: Page, index: number): Promise<boolean> {
	return page.evaluate(
		(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
		index
	);
}

function mountedTopLevelIndices(page: Page): Promise<number[]> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')).map(
			(el) => JSON.parse(el.getAttribute('data-block-path')!)[0] as number
		)
	);
}

function capturePageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

// Drive a fast fling — ~1 viewport per animation frame — inside ONE in-page rAF
// loop, counting every element matching `selector` that mounts via a
// MutationObserver (`.block-host` for top-level hosts, `[data-table-row-idx]` for
// windowed table rows). A real rAF loop is load-bearing: per-step `scrollEditorTo`
// (double-rAF between writes) mounts only a handful per frame, which inflates
// layouts/mount and flakes; one viewport per frame mounts a windowful at once so
// gross mounts far exceed the frame count. Returns the gross mount tally to pair
// with the CDP layout delta bracketed around it.
async function flingAndCountMounts(page: Page, frames: number, selector: string): Promise<number> {
	return page.evaluate(
		({ frames, selector }) => {
			const el = document.querySelector('.editor') as HTMLElement;
			const step = el.clientHeight; // ~1 viewport per frame
			let mounts = 0;
			const observer = new MutationObserver((records) => {
				for (const record of records) {
					for (const added of record.addedNodes) {
						if (added instanceof HTMLElement) {
							if (added.matches(selector)) mounts++;
							mounts += added.querySelectorAll(selector).length;
						}
					}
				}
			});
			observer.observe(el, { childList: true, subtree: true });
			return new Promise<number>((resolve) => {
				let frame = 0;
				function tick() {
					if (frame++ >= frames) {
						observer.disconnect();
						resolve(mounts);
						return;
					}
					el.scrollTop += step;
					requestAnimationFrame(tick);
				}
				requestAnimationFrame(tick);
			});
		},
		{ frames, selector }
	);
}

// VR-4 regression guard. The per-block measure-then-mutate path (BlockHost's edit
// `$effect` calling `measureNow`, TableRowBlock's `measureRowNow`) must not run on
// mount: on a fling many blocks mount in one frame, and a per-block
// `getBoundingClientRect` read interleaved with the prior block's model write forces
// one synchronous reflow PER mounted block. The scope's batched read-all-then-write
// pass owns mount measurement instead, so a windowful costs one reflow, not N.
//
// The honest signal is layouts-per-mount on a fling, read via CDP LayoutCount
// (real-browser only — jsdom and the unit suite can't see forced reflows, which is
// why the bug shipped green). The broken (mount-run-not-skipped) build measures ~1.0
// layouts/mount — one forced reflow per mounted block; the fixed build measures ~0.03
// — the batch's single reflow amortized over the windowful. The < 0.3 bound sits an
// order of magnitude below the 1:1 thrash signature and well above the fixed value, so
// it fails the regression without flaking on Chromium layout-count jitter.
test('a fling does not force one reflow per mounted block (VR-4)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	const blockCount = await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);
	expect(blockCount).toBeGreaterThan(2000); // enough off-window blocks to fling through

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const layoutCount = async (): Promise<number> => {
		const metrics: any = await cdp.send('Performance.getMetrics');
		return metrics.metrics.find((m: any) => m.name === 'LayoutCount')?.value ?? 0;
	};

	// Settle the post-load layout so the before-bracket has no pending reflow.
	await editor.waitForRenderFlush();
	const layoutsBefore = await layoutCount();
	const mounts = await flingAndCountMounts(page, 10, '.block-host');
	const layoutsAfter = await layoutCount();

	const layouts = layoutsAfter - layoutsBefore;
	const perMount = mounts > 0 ? layouts / mounts : Infinity;
	console.log(`VR-4 reflow guard ${JSON.stringify({ mounts, layouts, perMount })}`);

	// Denominator floor: a fling that mounts nothing would make perMount vacuously
	// small. A windowful per frame over 10 frames mounts hundreds of hosts.
	expect(mounts).toBeGreaterThan(200);
	// One forced reflow per mounted block is ~1.0; the batch amortizes to ~0.03.
	expect(perMount).toBeLessThan(0.3);
	expect(pageErrors).toEqual([]);
});

// VR-4 regression guard for the TABLE-ROW path. Rows aren't BlockHosts, so the
// guard above (no-table fixture) never exercises TableRowBlock's mount-run skip —
// reverting only that skip leaves it green, the same blind spot that let VR-4
// ship. This mirrors it on a giant windowed table: TableRowBlock's `measureRowNow`
// edit `$effect` must skip its mount run so a fling's per-row cell read doesn't
// interleave with the prior row's subtotal write (one forced reflow per mounted
// row). The scope's batched read-all-then-write pass owns mount measurement, so a
// windowful of rows costs one reflow, not N. Same CDP LayoutCount signal and < 0.3
// bound as the BlockHost guard: the broken (mount-run-not-skipped) build measures
// ~1.0 layouts/mount, the fixed build ~0.05 — the bound sits an order of magnitude
// below the 1:1 thrash and well above the fixed value.
test('a fling does not force one reflow per mounted table row (VR-4 table path)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	await editor.loadLargeFixture('giant-single-table', 2_000_000);
	// Precondition: the table windows its rows, so a fling genuinely mounts off-window
	// rows rather than scrolling over an already-fully-rendered grid.
	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const layoutCount = async (): Promise<number> => {
		const metrics: any = await cdp.send('Performance.getMetrics');
		return metrics.metrics.find((m: any) => m.name === 'LayoutCount')?.value ?? 0;
	};

	await editor.waitForRenderFlush();
	const layoutsBefore = await layoutCount();
	const mounts = await flingAndCountMounts(page, 10, '[data-table-row-idx]');
	const layoutsAfter = await layoutCount();

	const layouts = layoutsAfter - layoutsBefore;
	const perMount = mounts > 0 ? layouts / mounts : Infinity;
	console.log(`VR-4 table reflow guard ${JSON.stringify({ mounts, layouts, perMount })}`);

	// Denominator floor: a fling that mounts no rows would make perMount vacuously
	// small. Short uniform rows pack densely, so a windowful per frame over 10 frames
	// mounts hundreds of rows.
	expect(mounts).toBeGreaterThan(200);
	// One forced reflow per mounted row is ~1.0; the batch amortizes to ~0.05.
	expect(perMount).toBeLessThan(0.3);
	expect(pageErrors).toEqual([]);
});

test('windowing bounds the mounted set on a multi-thousand-block doc', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

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

test('Ctrl+Shift+End reveals and edits the off-window last block', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	const blockCount = await cstBlockCount(page);
	const last = blockCount - 1;

	// Precondition: windowing must be active and the last block off-window, or the
	// marker-at-end assertion would pass without ever hitting reveal.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	expect(await editor.getDomBlockCount()).toBeLessThan(blockCount);
	expect(await topLevelHostPresent(page, last)).toBe(false);

	await editor.focusBlockStart(0);
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse the range to its end
	await editor.typeText('VR_MARKER');
	await editor.bridge.waitForSourceContains('VR_MARKER', 10_000);

	const source = await editor.bridge.getSource();
	expect(source.trimEnd().endsWith('VR_MARKER')).toBe(true);
	expect(pageErrors).toEqual([]);
});

test('undo of an off-window block edit reverts cleanly and restores focus', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	await editor.focusBlockStart(0);
	await editor.typeText('ALPHA_MARK');
	await editor.bridge.waitForSourceContains('ALPHA_MARK');
	await editor.waitForUndoBatchFlush();

	// Scroll to the very bottom: the focus pin only keeps block 0 mounted within
	// pinExtensionCap blocks, so a one-viewport scroll wouldn't unmount it. The
	// bottom puts the window's start well past the cap.
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(scrollHeight);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	// Undo's keydown handler is block-scoped, so a key press needs a focused,
	// mounted block to route to. Scrolling block 0 off-window dropped its focus
	// (the pin blurs past the cap), so focus a block that's actually in the
	// bottom window. Undo itself is editor-global — it targets block 0 regardless
	// of which block holds focus — so the reveal still has to scroll block 0 back.
	const mounted = await mountedTopLevelIndices(page);
	const focusTarget = mounted[Math.floor(mounted.length / 2)];
	expect(focusTarget).toBeGreaterThan(100);
	await editor.focusBlockStart(focusTarget);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	await editor.undo();
	await editor.bridge.waitForSourceNotContains('ALPHA_MARK', 10_000);
	expect(await editor.bridge.getSource()).not.toContain('ALPHA_MARK');

	// The source reverts synchronously, but revealPath remounts block 0 and
	// places the caret a few ticks later. Wait for (and assert) the remount —
	// the reveal's mounting half — before typing, or BETA_MARK could land before
	// the caret is placed. A reveal that never remounts block 0 fails here.
	await page.waitForFunction(() => !!document.querySelector("[data-block-path='[0]']"), null, {
		timeout: 10_000,
		polling: 16
	});
	expect(await topLevelHostPresent(page, 0)).toBe(true);

	// Stronger reveal assertion: the undo's revealPath should have landed the
	// caret back in block 0, so the next type appears there.
	await editor.typeText('BETA_MARK');
	await editor.bridge.waitForSourceContains('BETA_MARK', 10_000);
	expect(await editor.getBlockText(0)).toContain('BETA_MARK');
	expect(pageErrors).toEqual([]);
});

test('scrolling to a mid offset does not make the top visible block vanish', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(Math.round(scrollHeight / 2));

	// Identify the top-level block sitting at the top of the viewport and its
	// in-viewport offset.
	const topBlock = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const hosts = Array.from(
			document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > top + 1)
				return { path: host.getAttribute('data-block-path'), top: rect.top };
		}
		return null;
	});
	expect(topBlock).not.toBeNull();

	await editor.waitForRenderFlush();

	// The same block must still be present and not have teleported. Phase 2 ships
	// estimate-based spacers, so allow generous drift — the asserted invariant is
	// non-disappearance, not pixel-perfect anchoring.
	const after = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, topBlock!.path);
	expect(after).not.toBeNull();
	expect(Math.abs(after! - topBlock!.top)).toBeLessThan(200);
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

test('reveals a deep off-window nested item and lands the caret there', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-list', 2_000_000);

	// The deep last leaf lives at [0, lastItem, 0] (list → last item → its paragraph).
	const lastItem = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length - 1
	);

	// Precondition: the list is windowed AND the deep last leaf is genuinely
	// unmounted, so the marker-at-end assertion can only pass if reveal scrolls and
	// mounts it. Without this the test is vacuous.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	const deepHostPath = JSON.stringify([0, lastItem, 0]);
	expect(
		await page.evaluate((p) => document.querySelector(`[data-block-path='${p}']`), deepHostPath)
	).toBeNull();

	// Real click into the first item's mounted content leaf [0,0,0]. focusBlockStart(0)
	// would target the list CONTAINER ([0] = the non-focusable .list-block div), so its
	// programmatic focus()+range never routes the Ctrl+Shift+End keydown. The deep last
	// leaf is off-window, so it routes through revealPath's async nested descent.
	await editor.clickBlockAtPath([0, 0, 0], 0);
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse the range to the revealed end
	await editor.typeText('DEEP_VR_MARKER');
	await editor.bridge.waitForSourceContains('DEEP_VR_MARKER', 10_000);

	const source = await editor.bridge.getSource();
	expect(source.trimEnd().endsWith('DEEP_VR_MARKER')).toBe(true); // landed in the LAST item, not item 0
	expect(pageErrors).toEqual([]);
});

test('collapsing a Ctrl+Shift+End list selection to start lands the caret in the anchor item', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-list', 2_000_000);

	const itemCountBefore = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// The list windows, and its mirror of the table collapse-to-start test guards the
	// SAME regressions for a list scope: the caret lands in the anchor item (not the
	// focus item) and the body survives the collapse. Item 0 stays in-window here —
	// unlike the table, Ctrl+Shift+End leaves the list scroll untouched (the doc-edge
	// reveal only scrolls for cell-coordinate focus), so the off-window reveal half is
	// out of keyboard reach. The canonical revealByPath's in-window path is the one
	// exercised, and its windowed-mount loop is unit-covered in revealChildOrWait.
	expect(await spacerCount(page)).toBeGreaterThan(0);

	await editor.clickBlockAtPath([0, 0, 0], 0);
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);

	// ArrowLeft collapses the cross-block selection to its start (the row-0 anchor
	// item). waitForCrossBlock(false) before typing: the collapse is async, so typing
	// immediately would race the still-active selection into a destructive type-replace.
	await page.keyboard.press('ArrowLeft');
	await editor.waitForCrossBlock(false);

	await editor.typeText('LIST_START_MARKER');
	await editor.bridge.waitForSourceContains('LIST_START_MARKER', 10_000);

	// The marker lands on source line 0 (the anchor item), not the last line — a
	// wrong-item caret would put it in the focus item.
	const source = await editor.bridge.getSource();
	expect(source.split('\n')[0]).toContain('LIST_START_MARKER');

	// The body must SURVIVE the collapse — a destructive range-replace would wipe
	// the list to a handful of items. CST item count is windowing-independent.
	const itemCountAfter = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);
	expect(itemCountAfter).toBe(itemCountBefore);
	expect(pageErrors).toEqual([]);
});

test('structural edit in a windowed non-uniform list keeps the viewport stable', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Non-uniform on purpose: every 8th item wraps to many lines, the rest are one
	// line. A uniform fixture can't catch the bug — every slot's estimate already
	// equals its measured height, so a rebuild's reseed is a no-op. ~600 items clear
	// the 4000px activation watermark with room to spare.
	const md =
		Array.from({ length: 600 }, (_, i) => `- ${'word '.repeat(i % 8 === 0 ? 60 : 4).trim()}`).join(
			'\n'
		) + '\n';
	await editor.loadContent(md);

	expect(
		await page.evaluate(() => document.querySelectorAll('.list-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	const itemCount = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// Progressive scroll 0 → middle, ~0.6 viewport per step, flushing between. This
	// MOUNTS and measures every item the window passes over — list items reach the
	// model only via setChildSubtotal, and only when mounted. A direct jump leaves
	// the above-window items at estimate in BOTH branches, so the rebuild would
	// change nothing there and the test couldn't tell Fix 1 apart. Measuring them
	// in first is what makes the rebuild's reseed observable.
	const viewport = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).clientHeight
	);
	const target = await page.evaluate(() =>
		Math.round((document.querySelector('.editor') as HTMLElement).scrollHeight / 2)
	);
	for (let top = 0; top < target; top += Math.round(viewport * 0.6)) {
		await editor.scrollEditorTo(top);
	}
	await editor.scrollEditorTo(target);
	await editor.waitForRenderFlush();

	// Reference: the topmost in-view nested CONTENT host (list items aren't
	// data-block-path; their paragraph is, at [0, k, 0]). Edit a host LOWER in the
	// viewport so the inserted sibling lands below the reference and its path stays
	// stable — re-querying the same path after an edit above it would read a
	// different item.
	const inView = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const bottom = editorEl.getBoundingClientRect().bottom;
		const hosts = Array.from(document.querySelectorAll('[data-block-path*=","]')) as HTMLElement[];
		const visible = hosts
			.map((h) => ({
				path: h.getAttribute('data-block-path')!,
				top: h.getBoundingClientRect().top
			}))
			.filter((h) => {
				const el = document.querySelector(`[data-block-path='${h.path}']`) as HTMLElement;
				const rect = el.getBoundingClientRect();
				return rect.bottom > top + 1 && rect.top < bottom;
			});
		return { reference: visible[0], editTarget: visible[Math.min(3, visible.length - 1)] };
	});
	expect(inView.reference).toBeTruthy();
	expect(inView.editTarget).toBeTruthy();

	const scrollHeightBefore = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);

	// Real structural edit: click into a visible item's content and press Enter at
	// its end to split off a NEW sibling item (+1 to the list's child count), which
	// triggers the ListBlock rebuild. Verify the count actually changed — a split
	// that only touched inner content wouldn't rebuild and would prove nothing.
	const editPath = JSON.parse(inView.editTarget.path) as number[];
	const editLen = await page.evaluate((p) => {
		const el = document.querySelector(`[data-block-path='${JSON.stringify(p)}']`) as HTMLElement;
		return el?.textContent?.length ?? 0;
	}, editPath);
	await editor.clickBlockAtPath(editPath, editLen);
	await page.keyboard.press('Enter');
	// Windowing mounts only a slice, so the DOM .list-item-block count isn't the
	// full item count — poll the CST list's child count instead.
	await page.waitForFunction(
		(n) => (window as any).__test.getDocument().children[0].children.length === n,
		itemCount + 1,
		{ timeout: 5000, polling: 16 }
	);
	await editor.waitForRenderFlush();

	// Primary signal: scrollHeight stability. Without Fix 1 the rebuild reseeds every
	// above-window item from estimate, collapsing the spacer-backed content height by
	// thousands of px; the single added item moves it only by one item's height.
	const scrollHeightAfter = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	expect(Math.abs(scrollHeightAfter - scrollHeightBefore)).toBeLessThan(500);

	// Corroborating signal: the reference host (above the edit) must not teleport.
	const referenceAfter = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, inView.reference.path);
	expect(referenceAfter).not.toBeNull();
	expect(Math.abs(referenceAfter! - inView.reference.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

test('nested: scrolling mid into a giant blockquote does not teleport the top nested block', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-blockquote', 2_000_000);

	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(Math.round(scrollHeight / 2));

	// The NESTED host (path carries a comma) at the top of the viewport, and its
	// in-viewport offset. Inverts the top-level anchor test's :not([*=","]) filter.
	const topNested = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const hosts = Array.from(document.querySelectorAll('[data-block-path*=","]')) as HTMLElement[];
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > top + 1)
				return { path: host.getAttribute('data-block-path'), top: rect.top };
		}
		return null;
	});
	expect(topNested).not.toBeNull();

	await editor.waitForRenderFlush();

	const after = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, topNested!.path);
	expect(after).not.toBeNull();
	// Phase-3 ships estimate-based spacers at depth, so allow generous drift — the
	// asserted invariant is non-disappearance, not pixel-perfect anchoring.
	expect(Math.abs(after! - topNested!.top)).toBeLessThan(250);
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

test('reveals an off-window table cell by scroll and edits it (phase 4)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	// Scroll-reveal route. The keyboard route (Ctrl+Shift+End → collapse) is
	// covered by the two cross-block tests above; this one proves the same
	// correctness property — scroll windows in a far row, an edit lands there —
	// via the pointer path.

	// Snapshot the initial window's far edge: every asserted target row must be
	// beyond it, so the test can only pass if the scroll mounted a genuinely
	// off-window row.
	const initialMaxRow = await page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-table-row-idx]')).reduce(
			(max, el) => Math.max(max, Number(el.getAttribute('data-table-row-idx'))),
			-1
		)
	);

	// Precondition: windowed AND a far row genuinely unmounted at load, or the
	// assertions below are vacuous.
	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(Math.round(scrollHeight * 0.9));

	// A far row, well past the initial window, that the scroll mounted. Click its
	// first cell, type a marker, and assert both the row idx is off-window and the
	// marker reached the source.
	const target = await page.evaluate((initialMax) => {
		const rows = Array.from(document.querySelectorAll('[data-table-row-idx]')) as HTMLElement[];
		const far = rows
			.map((r) => Number(r.getAttribute('data-table-row-idx')))
			.filter((idx) => idx > initialMax + 10)
			.sort((a, b) => a - b);
		return far[Math.floor(far.length / 2)] ?? null;
	}, initialMaxRow);
	expect(target).not.toBeNull();
	expect(target!).toBeGreaterThan(initialMaxRow + 10);

	await page.locator(`[data-table-row-idx="${target}"] [role="cell"]`).first().click();
	await editor.typeText('CELL_VR_MARKER');
	await editor.bridge.waitForSourceContains('CELL_VR_MARKER', 10_000);

	// The marker landed in the far (originally off-window) row's mounted cell, not
	// at the top — scroll-windowing mounted it and the edit reached it.
	expect(
		await page.evaluate(
			(t) => document.querySelector(`[data-table-row-idx="${t}"]`)?.textContent ?? '',
			target
		)
	).toContain('CELL_VR_MARKER');
	expect((await editor.bridge.getSource()).includes('CELL_VR_MARKER')).toBe(true);
	expect(pageErrors).toEqual([]);
});

test('Ctrl+Shift+End in a table reveals and mounts the off-window focus cell (phase 4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	const lastRow = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length - 1
	);

	// Precondition: windowed AND the last row genuinely off-window, or the
	// reveal assertion below is vacuous.
	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	expect(
		await page.evaluate((r) => document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).toBeNull();

	// Real click into the first mounted cell, then Ctrl+Shift+End. The focus
	// normalizes to a cell-coordinate endpoint at the table block; without Fix A
	// the extend scrolls the table top and never mounts the off-window last row.
	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);

	// [data-cross-block] attaches at enterCrossBlock, BEFORE the awaited reveal —
	// wait for the row mount itself, not the cross-block flag.
	await page.waitForFunction(
		(r) => !!document.querySelector(`[data-table-row-idx="${r}"]`),
		lastRow,
		{ timeout: 10_000, polling: 16 }
	);
	expect(
		await page.evaluate((r) => document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).not.toBeNull();
	expect(pageErrors).toEqual([]);
});

test('collapsing a Ctrl+Shift+End table selection lands the caret in the revealed cell (phase 4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	const lastRow = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length - 1
	);

	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	expect(
		await page.evaluate((r) => document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).toBeNull();

	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse to the revealed end
	await editor.typeText('TABLE_END_MARKER');
	await editor.bridge.waitForSourceContains('TABLE_END_MARKER', 10_000);

	// Without Fix B the caret lands in the table grid at a meaningless linear
	// offset, so the marker misses the last row's last cell.
	expect(
		await page.evaluate(
			(r) => document.querySelector(`[data-table-row-idx="${r}"]`)?.textContent ?? '',
			lastRow
		)
	).toContain('TABLE_END_MARKER');
	expect(pageErrors).toEqual([]);
});

test('collapsing a Ctrl+Shift+End table selection to start does not wipe the table body (phase 4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	const rowCountBefore = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	expect(
		await page.evaluate(
			(r) => document.querySelector(`[data-table-row-idx="${r}"]`),
			rowCountBefore - 1
		)
	).toBeNull();

	// ArrowLeft collapses the cross-block selection to its start (the row-0 anchor
	// cell, off-window after Ctrl+Shift+End scrolled to the bottom). waitForCrossBlock(false)
	// before typing: the collapse is async, so typing immediately would race the
	// still-active selection into a destructive type-replace.
	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowLeft'); // collapse to the start
	await editor.waitForCrossBlock(false);

	// The collapse must REVEAL and focus the off-window anchor cell, not leave the
	// caret stranded in the off-window focus cell (the bug: revealByPath gated on a
	// stale ref slot and skipped mounting row 0). Assert the active cell is row 0.
	expect(
		await page.evaluate(() =>
			document.activeElement?.closest('[data-table-row-idx]')?.getAttribute('data-table-row-idx')
		)
	).toBe('0');

	await editor.typeText('TABLE_START_MARKER');
	await editor.bridge.waitForSourceContains('TABLE_START_MARKER', 10_000);

	// The marker lands in row 0's first cell — proving the caret reached the anchor,
	// not the focus cell. (A wrong-cell caret puts the marker in the last row.)
	expect(
		await page.evaluate(() => document.querySelector('[data-table-row-idx="0"]')?.textContent ?? '')
	).toContain('TABLE_START_MARKER');

	// The body must SURVIVE the collapse. A destructive range-replace (the pre-fix
	// behavior) wiped the table to a handful of rows. Assert via the CST row count,
	// which is windowing-independent — only the mounted DOM slice changes.
	const rowCountAfter = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);
	expect(rowCountAfter).toBe(rowCountBefore);
	expect(pageErrors).toEqual([]);
});

test('structural edit in a windowed non-uniform table keeps the viewport stable', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Non-uniform on purpose: every 8th body row is tall (multi-line cells via <br>),
	// the rest one line. A uniform table can't catch the bug — every slot's estimate
	// already equals its measured height, so a rebuild's reseed is a no-op. ~600 rows
	// clear the 4000px activation watermark with room to spare.
	const header = '| a | b | c |\n| --- | --- | --- |\n';
	const body =
		Array.from({ length: 600 }, (_, i) =>
			i % 8 === 0 ? `| ${'x<br>'.repeat(8)}x | y | z |` : `| p | q | r |`
		).join('\n') + '\n';
	await editor.loadContent(header + body);

	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	const rowCount = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// Progressive scroll 0 -> middle, ~0.6 viewport per step, flushing between, so the
	// window passes over (mounts + measures) the tall rows. Rows reach the model only
	// via setChildSubtotal, and only when mounted; a direct jump leaves above-window
	// rows at estimate and the rebuild would change nothing there.
	const viewport = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).clientHeight
	);
	const target = await page.evaluate(() =>
		Math.round((document.querySelector('.editor') as HTMLElement).scrollHeight / 2)
	);
	for (let top = 0; top < target; top += Math.round(viewport * 0.6)) {
		await editor.scrollEditorTo(top);
	}
	await editor.scrollEditorTo(target);
	await editor.waitForRenderFlush();

	// Reference: the topmost visible row's cell (by row-idx + top — a display:contents
	// row has no box, so track a CELL). Edit a row LOWER in the viewport so the inserted
	// sibling lands below the reference and the reference's row-idx stays stable.
	const view = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const bottom = editorEl.getBoundingClientRect().bottom;
		const rows = Array.from(document.querySelectorAll('[data-table-row-idx]')) as HTMLElement[];
		const visible = rows
			.map((r) => {
				const rect = (
					r.querySelector(':scope > .table-cell') as HTMLElement | null
				)?.getBoundingClientRect();
				return {
					idx: r.getAttribute('data-table-row-idx')!,
					top: rect?.top ?? null,
					bottom: rect?.bottom ?? null
				};
			})
			.filter((r) => r.top !== null && r.bottom! > top + 1 && r.top! < bottom);
		return { reference: visible[0], editIdx: visible[Math.min(3, visible.length - 1)]?.idx };
	});
	expect(view.reference).toBeTruthy();
	expect(view.editIdx).toBeTruthy();

	const scrollHeightBefore = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);

	// Real structural edit: click the lower visible cell, Ctrl+Enter inserts a row
	// below it (+1 to the table's child count), triggering the TableBlock rebuild.
	// Verify the count actually changed — an edit that didn't rebuild proves nothing.
	await page.locator(`[data-table-row-idx="${view.editIdx}"] [role="cell"]`).first().click();
	await page.keyboard.press('Control+Enter');
	await page.waitForFunction(
		(n) => (window as any).__test.getDocument().children[0].children.length === n,
		rowCount + 1,
		{ timeout: 5000, polling: 16 }
	);
	await editor.waitForRenderFlush();

	// Primary signal: scrollHeight stability. Without the oracle-persisting subtotal
	// write, the rebuild reseeds every above-window row from estimate, collapsing the
	// spacer-backed content height by thousands of px; one added row moves it only by
	// one row's height.
	const scrollHeightAfter = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	expect(Math.abs(scrollHeightAfter - scrollHeightBefore)).toBeLessThan(500);

	// Corroborating signal: the reference row (above the edit) must not teleport.
	const referenceAfter = await page.evaluate((idx) => {
		const cell = document
			.querySelector(`[data-table-row-idx="${idx}"]`)
			?.querySelector(':scope > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().top : null;
	}, view.reference.idx);
	expect(referenceAfter).not.toBeNull();
	expect(Math.abs(referenceAfter! - view.reference.top!)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

test('scrolling mid into a giant table does not teleport the top visible row', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(Math.round(scrollHeight / 2));

	// The row at the top of the viewport, tracked via a CELL's top (display:contents
	// row has no box). Identify the row by data-table-row-idx and read its first cell.
	const topRow = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const rows = Array.from(document.querySelectorAll('[data-table-row-idx]')) as HTMLElement[];
		for (const row of rows) {
			const cell = row.querySelector(':scope > .table-cell') as HTMLElement | null;
			if (!cell) continue;
			const rect = cell.getBoundingClientRect();
			if (rect.bottom > top + 1)
				return { idx: row.getAttribute('data-table-row-idx'), top: rect.top };
		}
		return null;
	});
	expect(topRow).not.toBeNull();

	await editor.waitForRenderFlush();

	// The same row must still be present and not have teleported. Estimate-based spacers
	// allow bounded drift; the invariant is non-disappearance, not pixel-perfect anchoring.
	// A systematic mis-measure (every row under-measured) blows past this bound.
	const after = await page.evaluate((idx) => {
		const cell = document
			.querySelector(`[data-table-row-idx="${idx}"]`)
			?.querySelector(':scope > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().top : null;
	}, topRow!.idx);
	expect(after).not.toBeNull();
	expect(Math.abs(after! - topRow!.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// VR-4 measure-batching guard. On a fling, many blocks mount in one frame; the
// per-block measure-then-mutate path must not force one synchronous reflow per
// mounted block. Read via CDP LayoutCount (real-browser only — jsdom reports zero
// layout, which is why the bug shipped green in the unit suite).

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

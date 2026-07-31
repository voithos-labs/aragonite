import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// VR-4 measure-batching guard. On a fling, many blocks mount in one frame; the
// per-block measure-then-mutate path must not force one synchronous reflow per
// mounted block. Read via CDP LayoutCount (real-browser only — jsdom reports zero
// layout, which is why the bug shipped green in the unit suite).

// One in-page rAF loop is load-bearing: per-step `scrollEditorTo` double-rAFs between
// writes and mounts only a handful per frame, which inflates layouts/mount and flakes.
// A viewport per frame mounts a windowful at once, so gross mounts far exceed frames.
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

// VR-4 regression guard. BlockHost's edit `$effect` must skip its mount run, or a
// per-block rect read interleaves with the prior block's model write and forces one
// synchronous reflow PER mounted block instead of one per batched pass.
// The 0.3 bound sits an order of magnitude below the 1:1 thrash signature (~1.0) and well
// above the batched value (~0.03), so it fails the regression without flaking on jitter.
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

	// Denominator floor: a fling that mounts nothing makes perMount vacuously small.
	expect(mounts).toBeGreaterThan(200);
	// One forced reflow per mounted block is ~1.0; the batch amortizes to ~0.03.
	expect(perMount).toBeLessThan(0.3);
	expect(pageErrors).toEqual([]);
});

// VR-4 regression guard for the TABLE-ROW path. Rows aren't BlockHosts, so reverting
// TableRowBlock's mount-run skip alone leaves the guard above green — the same blind spot
// that let VR-4 ship. Same signal and bound; the batched value here is ~0.05.
test('a fling does not force one reflow per mounted table row (VR-4 table path)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	await editor.loadLargeFixture('giant-single-table', 2_000_000);
	// Without row windowing the fling scrolls over an already-fully-rendered grid.
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

	// Denominator floor: a fling that mounts no rows makes perMount vacuously small.
	expect(mounts).toBeGreaterThan(200);
	// One forced reflow per mounted row is ~1.0; the batch amortizes to ~0.05.
	expect(perMount).toBeLessThan(0.3);
	expect(pageErrors).toEqual([]);
});

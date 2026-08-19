import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES, spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// VR-4 measure-batching guard. On a fling, many blocks mount in one frame; the
// per-block measure-then-mutate path must not force one synchronous reflow per
// mounted block. Read via CDP LayoutCount (real-browser only — jsdom reports zero
// layout, so no unit suite can see this).

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

// One CDP LayoutCount bracket around one fling, per mount-bearing scope. The 0.3 bound sits
// an order of magnitude below the 1:1 thrash signature (~1.0) and well above the batched
// values (~0.03 for blocks, ~0.05 for rows), so it fails the regression without flaking.
const PER_MOUNT_BOUND = 0.3;

interface ReflowRow {
	/** The mounting unit, as the title names it. */
	unit: string;
	tag: string;
	/** Loads the fixture and asserts the precondition that keeps the fling non-vacuous. */
	arrange: (page: Page, editor: EditorPage) => Promise<void>;
	selector: string;
	log: string;
}

const ROWS: ReflowRow[] = [
	{
		// BlockHost's edit `$effect` must skip its mount run, or a per-block rect read
		// interleaves with the prior block's model write and forces one synchronous reflow
		// PER mounted block instead of one per batched pass.
		unit: 'block',
		tag: 'VR-4',
		arrange: async (page, editor) => {
			const blockCount = await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);
			expect(blockCount).toBeGreaterThan(2000); // enough off-window blocks to fling through
		},
		selector: '.block-host',
		log: 'VR-4 reflow guard'
	},
	{
		// Rows aren't BlockHosts, so reverting TableRowBlock's mount-run skip alone leaves the
		// row above green — the same blind spot that let VR-4 ship.
		unit: 'table row',
		tag: 'VR-4 table path',
		arrange: async (page, editor) => {
			await editor.loadLargeFixture('giant-single-table', 2_000_000);
			// Without row windowing the fling scrolls over an already-fully-rendered grid.
			expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);
		},
		selector: '[data-table-row-idx]',
		log: 'VR-4 table reflow guard'
	}
];

async function cdpLayoutCount(page: Page): Promise<() => Promise<number>> {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	return async () => {
		const metrics: any = await cdp.send('Performance.getMetrics');
		return metrics.metrics.find((m: any) => m.name === 'LayoutCount')?.value ?? 0;
	};
}

for (const row of ROWS) {
	test(`a fling does not force one reflow per mounted ${row.unit} (${row.tag})`, async ({
		page
	}) => {
		const pageErrors = capturePageErrors(page);
		const editor = new EditorPage(page);
		await editor.goto();
		await row.arrange(page, editor);

		const layoutCount = await cdpLayoutCount(page);
		// Settle the post-load layout so the before-bracket has no pending reflow.
		await editor.waitForRenderFlush();
		const layoutsBefore = await layoutCount();
		const mounts = await flingAndCountMounts(page, 10, row.selector);
		const layouts = (await layoutCount()) - layoutsBefore;

		const perMount = mounts > 0 ? layouts / mounts : Infinity;
		console.log(`${row.log} ${JSON.stringify({ mounts, layouts, perMount })}`);

		// Denominator floor: a fling that mounts nothing makes perMount vacuously small.
		expect(mounts).toBeGreaterThan(200);
		expect(perMount).toBeLessThan(PER_MOUNT_BOUND);
		expect(pageErrors).toEqual([]);
	});
}

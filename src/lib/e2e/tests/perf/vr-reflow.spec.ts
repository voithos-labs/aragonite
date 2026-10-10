import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES, GIANT_LIST_OR_TABLE_BYTES, spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Batching the measurements (VR-4): when many blocks mount in one frame, measuring then writing
// per block must not force one layout per block. Read through CDP's LayoutCount, which needs a
// real browser, since jsdom reports no layout.

// One in-page animation-frame loop, a viewport per frame, mounts a whole window at once;
// `scrollEditorTo` per step waits two frames between writes, inflating layouts per mount.
async function flingAndCountMounts(page: Page, frames: number, selector: string): Promise<number> {
	return page.evaluate(
		({ frames, selector }) => {
			const el = document.querySelector('.editor') as HTMLElement;
			const step = el.clientHeight; // about one viewport per frame
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

// The 0.3 limit sits ten times below one layout per mount and well above the batched values of
// about 0.03 for blocks and 0.05 for rows.
const PER_MOUNT_BOUND = 0.3;

interface ReflowRow {
	/** What mounts here, named as the test title names it. */
	unit: string;
	tag: string;
	/** Loads the fixture and checks what has to hold for the scroll to prove anything. */
	arrange: (page: Page, editor: EditorPage) => Promise<void>;
	selector: string;
	log: string;
}

const ROWS: ReflowRow[] = [
	{
		// BlockHost's edit effect must skip its run on mount, or reading a block's box between the
		// previous block's write and its own forces one layout per mounted block.
		unit: 'block',
		tag: 'VR-4',
		arrange: async (page, editor) => {
			const blockCount = await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);
			expect(blockCount).toBeGreaterThan(2000); // enough unmounted blocks to scroll through
		},
		selector: '.block-host',
		log: 'VR-4 reflow guard'
	},
	{
		// Rows are not block hosts, so TableRowBlock's skip on mount needs its own case.
		unit: 'table row',
		tag: 'VR-4 table path',
		arrange: async (page, editor) => {
			await editor.loadLargeFixture('giant-single-table', GIANT_LIST_OR_TABLE_BYTES);
			// Without row windowing the scroll passes over a grid that is already fully rendered.
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
		// Let the layout after the load settle, so the first reading has no layout pending.
		await editor.waitForRenderFlush();
		const layoutsBefore = await layoutCount();
		const mounts = await flingAndCountMounts(page, 10, row.selector);
		const layouts = (await layoutCount()) - layoutsBefore;

		const perMount = mounts > 0 ? layouts / mounts : Infinity;
		console.log(`${row.log} ${JSON.stringify({ mounts, layouts, perMount })}`);

		// A lower bound on what it divides by: a scroll that mounts nothing would make the
		// layouts per mount meaninglessly small.
		expect(mounts).toBeGreaterThan(200);
		expect(perMount).toBeLessThan(PER_MOUNT_BOUND);
		expect(pageErrors).toEqual([]);
	});
}

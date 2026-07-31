import { test, expect } from '../../fixtures';
import { type Locator, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import { spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Host-scroll (flow) mode: several entries in one ancestor scroller, plus a pane that clips
// rather than scrolls. The root spans the whole document here, so measuring or scrolling IT
// would call an unreachable block visible and leave a drag stranded — every seam has to
// resolve against whatever actually scrolls the editor.

async function gotoFlow(page: Page): Promise<void> {
	await page.goto('/test/flow');
	await page.waitForFunction(() => (window as any).__flow !== undefined, null, { timeout: 10_000 });
}

const entry = (page: Page, id: string): Locator => page.locator(`[data-testid="entry-${id}"]`);

const hosts = (scope: Locator): Locator =>
	scope.locator('[data-block-path]:not([data-block-path*=","])');

const flowSource = (page: Page, id: string): Promise<string> =>
	page.evaluate((i) => (window as any).__flow.getSource(i) as string, id);

const blockCount = (page: Page, id: string): Promise<number> =>
	page.evaluate((i) => (window as any).__flow.blockCount(i) as number, id);

async function scrollHostTo(page: Page, top: number): Promise<void> {
	await page.evaluate((t) => {
		(document.querySelector('[data-testid="scroller"]') as HTMLElement).scrollTop = t;
	}, top);
	await page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
}

test('a host-scroll entry mounts every block and renders no spacers', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);

	const count = await blockCount(page, 'a');
	expect(count).toBe(200);
	await expect(hosts(entry(page, 'a'))).toHaveCount(count);
	await expect(entry(page, 'a').locator('.vr-spacer')).toHaveCount(0);
	expect(pageErrors).toEqual([]);

	// Attribution: the SAME source in a self-mode editor windows. Without this the
	// zero-spacer assertion above would pass on any document under the watermark.
	const source = await flowSource(page, 'a');
	const selfMode = new EditorPage(page);
	await selfMode.goto();
	await selfMode.loadContent(source);
	expect(await spacerCount(page)).toBeGreaterThan(0);
	expect(await selfMode.getDomBlockCount()).toBeLessThan(count);
});

test('the editor root stops being a scroll container and the ancestor carries the entry', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);

	const geometry = await page.evaluate(() => {
		const root = document.querySelector('[data-testid="entry-a"] .editor') as HTMLElement;
		const scroller = document.querySelector('[data-testid="scroller"]') as HTMLElement;
		return {
			overflowY: getComputedStyle(root).overflowY,
			rootOverflowPx: root.scrollHeight - root.clientHeight,
			rootHeight: root.getBoundingClientRect().height,
			scrollerOverflowPx: scroller.scrollHeight - scroller.clientHeight
		};
	});
	expect(geometry.overflowY).toBe('visible');
	expect(geometry.rootOverflowPx).toBeLessThanOrEqual(1);
	// The entry's full height is in the host's flow, and the host scrolls it.
	expect(geometry.rootHeight).toBeGreaterThan(4000);
	expect(geometry.scrollerOverflowPx).toBeGreaterThan(geometry.rootHeight);

	const topOf = () =>
		page.evaluate(
			() =>
				document
					.querySelector('[data-testid="entry-a"] [data-block-path="[0]"]')!
					.getBoundingClientRect().top
		);
	const before = await topOf();
	await scrollHostTo(page, 1500);
	expect(before - (await topOf())).toBeGreaterThan(1400);
	expect(pageErrors).toEqual([]);
});

test('typing and undo in a host-scroll entry behave as in self mode', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);

	await entry(page, 'a').locator('[contenteditable]').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type('FLOW_MARK');
	await expect.poll(() => flowSource(page, 'a')).toContain('FLOW_MARK');

	await page.waitForTimeout(300); // past the ~250ms undo-batch debounce
	await page.keyboard.press(`${primaryModifier}+z`);
	await expect.poll(() => flowSource(page, 'a')).not.toContain('FLOW_MARK');
	expect(pageErrors).toEqual([]);
});

test('scrollTo on a far block resolves true and lands it in the ancestor scrollport', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);

	expect(await page.evaluate(() => (window as any).__flow.scrollTo('a', [180]))).toBe(true);

	const seen = await page.evaluate(() => {
		const rect = (window as any).__flow.blockRect('a', [180]) as { top: number; bottom: number };
		const port = document.querySelector('[data-testid="scroller"]')!.getBoundingClientRect();
		return { ...rect, portTop: port.top, portBottom: port.bottom };
	});
	expect(seen.top).toBeLessThan(seen.portBottom);
	expect(seen.bottom).toBeGreaterThan(seen.portTop);
	expect(pageErrors).toEqual([]);
});

test('setSelection in a host-scroll entry reports true only once the block is in view', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);
	const at = (id: string, index: number) =>
		page.evaluate(
			({ id, index }) =>
				(window as any).__flow.setSelection(id, {
					anchor: { path: [index], offset: 0 },
					focus: { path: [index], offset: 0 }
				}),
			{ id, index }
		);

	// Task 1's contract crosses the mode: the restore scrolls the ANCESTOR and the
	// boolean means the block got there.
	expect(await at('a', 180)).toBe(true);
	const seen = await page.evaluate(() => {
		const rect = (window as any).__flow.blockRect('a', [180]) as { top: number; bottom: number };
		const port = document.querySelector('[data-testid="scroller"]')!.getBoundingClientRect();
		return { ...rect, portTop: port.top, portBottom: port.bottom };
	});
	expect(seen.top).toBeLessThan(seen.portBottom);
	expect(seen.bottom).toBeGreaterThan(seen.portTop);

	// And it inherits the clip bound rather than reporting a placement it can't make.
	expect(await at('clipped', 5)).toBe(false);
	expect(pageErrors).toEqual([]);
});

test('scrollTo on a path that addresses no block resolves false', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);
	expect(await page.evaluate(() => (window as any).__flow.scrollTo('a', [9999]))).toBe(false);
	expect(pageErrors).toEqual([]);
});

test('scrollTo past a clipping host edge resolves false — nothing can reveal the block', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);

	// The CLIP boundary is the case, not distance: the target sits past the pane's bottom
	// edge but well inside the window viewport, so a window-bounded measure calls it
	// visible. The neighbour above the edge must still read `true`, or "always false in a
	// clipping pane" would pass for the wrong reason.
	const geometry = await page.evaluate(() => {
		const pane = document.querySelector('[data-testid="entry-clipped"]')!.getBoundingClientRect();
		const below = (window as any).__flow.blockRect('clipped', [5]) as { top: number };
		return { paneBottom: pane.bottom, blockTop: below.top, viewport: window.innerHeight };
	});
	expect(geometry.blockTop).toBeGreaterThan(geometry.paneBottom);
	expect(geometry.blockTop).toBeLessThan(geometry.viewport); // inside the window: the crux

	expect(await page.evaluate(() => (window as any).__flow.scrollTo('clipped', [0]))).toBe(true);
	expect(await page.evaluate(() => (window as any).__flow.scrollTo('clipped', [5]))).toBe(false);
	expect(pageErrors).toEqual([]);
});

test('a drag at the scrollport edge autoscrolls the host, not the non-scrolling root', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);
	await scrollHostTo(page, 1100);

	const scrollTop = () =>
		page.evaluate(
			() => (document.querySelector('[data-testid="scroller"]') as HTMLElement).scrollTop
		);
	const before = await scrollTop();

	// The handle only mounts on hover. Grab it, then hold the pointer in the
	// scrollport's bottom edge band: the rAF autoscroll loop must move the ancestor.
	const source = entry(page, 'a').locator('.block-host').nth(2);
	await source.hover();
	const handle = await source.locator('.block-drag-handle').first().boundingBox();
	expect(handle).not.toBeNull();
	const port = (await page.locator('[data-testid="scroller"]').boundingBox())!;

	await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
	await page.mouse.down();
	await page.mouse.move(port.x + port.width / 2, port.y + port.height - 5, { steps: 12 });
	await expect.poll(scrollTop).toBeGreaterThan(before + 50);

	// Escape cancels the drop, so the assertion above is about scrolling only.
	await page.keyboard.press('Escape');
	await page.mouse.up();
	expect(pageErrors).toEqual([]);
});

test('the find bar rides the entry top edge, not the ancestor scrollport', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);

	// The entry starts below the fold; scroll it into reach before focusing a block.
	await scrollHostTo(page, 1100);
	await entry(page, 'a').locator('[contenteditable]').first().click();
	await page.keyboard.press(`${primaryModifier}+f`);
	await expect(page.locator('.search-bar')).toHaveCount(1);
	await expect(entry(page, 'a').locator('.search-bar')).toHaveCount(1);

	const offsets = async (scrollTop: number) => {
		await scrollHostTo(page, scrollTop);
		return page.evaluate(() => {
			const bar = document.querySelector('[data-testid="entry-a"] .search-bar')!;
			const root = document.querySelector('[data-testid="entry-a"] .editor')!;
			const scroller = document.querySelector('[data-testid="scroller"]')!;
			const barTop = bar.getBoundingClientRect().top;
			return {
				fromEntry: barTop - root.getBoundingClientRect().top,
				fromScrollport: barTop - scroller.getBoundingClientRect().top
			};
		});
	};
	const near = await offsets(1200);
	const far = await offsets(1800);

	// Constant against the entry: the bar scrolls away with its own editor.
	expect(Math.abs(near.fromEntry - far.fromEntry)).toBeLessThan(2);
	expect(near.fromEntry).toBeLessThan(40);
	// And genuinely gone from the scrollport top — a sticky anchor resolving against
	// the ancestor would park it there, floating over the page's other content.
	expect(far.fromScrollport).toBeLessThan(-200);
	expect(pageErrors).toEqual([]);
});

test('nested scopes in a host-scroll entry mount every child and stay error-free', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);
	const nested = entry(page, 'nested');

	// Both nested scope shapes, each over the watermark on its own — in self mode both
	// would window.
	const [items, rows] = await Promise.all([
		page.evaluate(() => (window as any).__flow.childCount('nested', [1]) as number),
		page.evaluate(() => (window as any).__flow.childCount('nested', [2]) as number)
	]);
	expect(items).toBeGreaterThan(100);
	expect(rows).toBeGreaterThan(100);

	// List items and table rows are direct-`{#each}` children, not BlockHosts, so
	// they census by their own element rather than by `data-block-kind`.
	await expect(nested.locator('.list-item-block')).toHaveCount(items);
	await expect(nested.locator('[data-table-row-idx]')).toHaveCount(rows);
	await expect(nested.locator('.vr-spacer')).toHaveCount(0);

	// Editing inside a nested scope drives the measure/subtotal path that reports up
	// through a parent model nothing reads — a render-phase throw there fails here.
	await nested.locator('.list-item-block [contenteditable]').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type('NESTED_MARK');
	await expect.poll(() => flowSource(page, 'nested')).toContain('NESTED_MARK');
	expect(pageErrors).toEqual([]);
});

test('two entries in one scroller both mount fully and stay independent', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoFlow(page);

	const [countA, countB] = [await blockCount(page, 'a'), await blockCount(page, 'b')];
	// Different sizes, so an assertion that read one entry twice cannot pass.
	expect(countA).not.toBe(countB);
	await expect(hosts(entry(page, 'a'))).toHaveCount(countA);
	await expect(hosts(entry(page, 'b'))).toHaveCount(countB);
	await expect(page.locator('.vr-spacer')).toHaveCount(0);

	const sourceABefore = await flowSource(page, 'a');
	await entry(page, 'b').locator('[contenteditable]').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type('BETA_MARK');
	await expect.poll(() => flowSource(page, 'b')).toContain('BETA_MARK');

	expect(await flowSource(page, 'a')).toBe(sourceABefore);
	expect(pageErrors).toEqual([]);
});

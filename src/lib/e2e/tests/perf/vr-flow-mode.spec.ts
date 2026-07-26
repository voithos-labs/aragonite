import { test, expect } from '../../fixtures';
import { type Locator, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import { spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Host-scroll (flow) mode on /test/flow: two journal entries in one ancestor
// scroller plus a pane that clips rather than scrolls. Windowing never activates,
// reveal stays honest against the WINDOW viewport (the root spans the whole
// document, so measuring against it would call an unreachable block visible), and
// the find bar rides the entry's own top edge.

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
	await gotoFlow(page);

	const geometry = await page.evaluate(() => {
		const root = document.querySelector('[data-testid="entry-a"] .editor') as HTMLElement;
		const scroller = document.querySelector('[data-testid="scroller"]') as HTMLElement;
		return {
			overflowY: getComputedStyle(root).overflowY,
			overflowAnchor: getComputedStyle(root).overflowAnchor,
			rootOverflowPx: root.scrollHeight - root.clientHeight,
			rootHeight: root.getBoundingClientRect().height,
			scrollerOverflowPx: scroller.scrollHeight - scroller.clientHeight
		};
	});
	expect(geometry.overflowY).toBe('visible');
	expect(geometry.rootOverflowPx).toBeLessThanOrEqual(1);
	// Self mode disables native anchoring because list-windowing corrects the scroll
	// by hand; here that correction lands on a non-scrolling element, so the host's
	// scroller must be allowed to anchor instead.
	expect(geometry.overflowAnchor).toBe('auto');
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

test('scrollTo on a far block resolves true and lands it in the window viewport', async ({
	page
}) => {
	await gotoFlow(page);

	expect(await page.evaluate(() => (window as any).__flow.scrollTo('a', [180]))).toBe(true);

	const seen = await page.evaluate(() => {
		const rect = (window as any).__flow.blockRect('a', [180]) as { top: number; bottom: number };
		return { ...rect, viewport: window.innerHeight };
	});
	expect(seen.top).toBeLessThan(seen.viewport);
	expect(seen.bottom).toBeGreaterThan(0);
});

test('scrollTo on a path that addresses no block resolves false', async ({ page }) => {
	await gotoFlow(page);
	expect(await page.evaluate(() => (window as any).__flow.scrollTo('a', [9999]))).toBe(false);
});

test('scrollTo inside a clipping host resolves false — nothing can reveal the block', async ({
	page
}) => {
	await gotoFlow(page);

	// The block IS mounted (host mode mounts all of them), so a false here reports
	// "not visible", not "not found" — the distinction the honest boolean carries.
	await expect(entry(page, 'clipped').locator('[data-block-path="[55]"]')).toHaveCount(1);
	expect(await page.evaluate(() => (window as any).__flow.scrollTo('clipped', [55]))).toBe(false);
});

test('the find bar rides the entry top edge, not the ancestor scrollport', async ({ page }) => {
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

import { test, expect } from '../../fixtures';
import { type Locator, type Page } from '@playwright/test';
import { waitForEditorHydrated } from '../../page-probes';

// The `/` showcase as a CONSUMING page (requirements/plugins/showcase-occurrences.md): the
// library paints `.decoration-overlay` geometry and leaves the color to the host, so the marks
// mount whether or not the host styles them. Every other occurrence spec runs on the plugins
// harness, which styles the class, so only a spec on `/` can see the paint go missing.

const OCCURRENCE = '.decoration-overlay.hl-occurrence';

/** The alpha of the element's own background: 0 for `rgba(0, 0, 0, 0)` and for `transparent`. */
function backgroundAlpha(overlay: Locator): Promise<number> {
	return overlay.evaluate((el) => {
		const channels = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? [];
		if (channels.length === 4) return Number(channels[3]);
		return channels.length === 3 ? 1 : 0;
	});
}

/**
 * Click the center of the word's own client rect. A character offset counted from the block
 * start would retarget itself the next time the showcase prose is edited.
 */
async function clickWord(page: Page, host: Locator, word: string): Promise<void> {
	// The showcase windows its blocks, so a host below the first screen is not in the DOM until
	// the page scrolls to it; `scrollIntoViewIfNeeded` alone would wait on it forever.
	for (let step = 0; step < 40 && (await host.count()) === 0; step++) {
		await page.evaluate(() => {
			window.scrollBy(0, 400);
			for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
				const { overflowY } = getComputedStyle(el);
				if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
					el.scrollTop += 400;
				}
			}
		});
		await page.waitForTimeout(100);
	}
	await host.scrollIntoViewIfNeeded();
	const point = await host.evaluate((block, target: string) => {
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = (node.textContent ?? '').indexOf(target);
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + target.length);
			const rect = range.getBoundingClientRect();
			return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
		}
		return null;
	}, word);
	expect(point, `no text node holding "${word}"`).not.toBeNull();
	await page.mouse.click(point!.x, point!.y);
}

test.describe('/ showcase occurrence highlight', () => {
	let banana: Locator;

	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// The route SSRs, and a click landing before hydration reaches no handler.
		await waitForEditorHydrated(page);
		banana = page.locator('.block-host', { hasText: 'every banana on this page' }).last();
	});

	// The two editing modes the showcase opens in and sells itself on. Reading has no caret,
	// so it has no occurrence highlight to paint (decorations/hloccur-memo owns that).
	for (const mode of ['source', 'live'] as const) {
		test(`a caret inside "banana" lights the other three in ${mode} mode`, async ({ page }) => {
			if (mode === 'live') await page.locator('.showcase-mode[data-mode="live"]').click();

			await clickWord(page, banana, 'banana');

			await expect(page.locator(OCCURRENCE)).toHaveCount(4);
			expect(await backgroundAlpha(page.locator(OCCURRENCE).first())).toBeGreaterThan(0);
		});
	}
});

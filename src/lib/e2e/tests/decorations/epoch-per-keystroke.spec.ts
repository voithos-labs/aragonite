import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { freezeInPageClock, PAST_TYPING_PAUSE_MS } from '../../page-probes';

/**
 * The edit counter bumps once per keystroke (requirements/decorations/epoch-per-keystroke.md).
 * The clock is frozen after setup, so the typing batch's pause elapses only when the spec
 * advances it: the marks step aside on the keystroke and the advance is what brings them back.
 */

const WORD = 'alpha';
const OCCURRENCE = '.decoration-overlay.hl-occurrence';

interface Probe {
	/** Occurrences of the word in block [0] whose live Range rect an overlay covers. */
	aligned: number;
	/** Overlays painted in block [0]: a stale mark measures into extra fragments. */
	painted: number;
	words: number;
	/** Left edge of each occurrence, the liveness half of the reference check. */
	wordLefts: number[];
}

/** Measures each painted overlay against that word's current rect, so the reference is the
 *  document's live geometry rather than a remembered pixel. */
function probe(page: Page): Promise<Probe> {
	return page.evaluate((word) => {
		const bridge = (window as any).__test;
		const block = document.querySelector("[data-block-path='[0]']");
		if (!block) throw new Error('probe: no block [0]');

		// The marks address raw offsets, so each occurrence is found in the raw text and measured
		// through the block's own raw-to-DOM mapping.
		const raw: string = bridge.getDocument().children[0].raw;
		const wordRects: { left: number; right: number }[] = [];
		for (let i = raw.indexOf(word); i !== -1; i = raw.indexOf(word, i + word.length)) {
			const rects: DOMRect[] = bridge.rects.rangeRects([0], i, i + word.length);
			wordRects.push({
				left: Math.min(...rects.map((r) => r.left)),
				right: Math.max(...rects.map((r) => r.right))
			});
		}
		const overlays = [...block.querySelectorAll('.decoration-overlay.hl-occurrence')].map((el) =>
			el.getBoundingClientRect()
		);
		const covers = (o: DOMRect, w: { left: number; right: number }) =>
			Math.abs(o.left - w.left) < 1.5 && Math.abs(o.right - w.right) < 1.5;
		return {
			aligned: wordRects.filter((w) => overlays.some((o) => covers(o, w))).length,
			painted: overlays.length,
			words: wordRects.length,
			wordLefts: wordRects.map((w) => w.left)
		};
	}, WORD);
}

async function coverage(page: Page): Promise<Omit<Probe, 'wordLefts'>> {
	const { aligned, painted, words } = await probe(page);
	return { aligned, painted, words };
}

function scanCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__hloccurScans ?? 0);
}

test.describe('decoration refresh per keystroke, not per typing batch', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('hloccur-memo');
		await editor.clickBlockAtPath([0], 0); // caret before the first 'alpha'
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);
	});

	test('a typed space clears the overlays, and the pause repaints them on the moved words', async ({
		page
	}) => {
		expect(await coverage(page)).toEqual({ aligned: 2, painted: 2, words: 2 });
		const [wordLeft] = (await probe(page)).wordLefts;

		// Frozen from here: no in-page timer fires until this spec advances the clock, so
		// the typing batch flushes exactly where the test says it does.
		await freezeInPageClock(page);
		await page.keyboard.type(' ');

		// Liveness first: the word itself moved under the frozen clock, so the empty overlay
		// set below is the marks stepping aside, not a page that stopped rendering.
		await expect.poll(async () => (await probe(page)).wordLefts[0]).toBeGreaterThan(wordLeft + 1);
		await expect.poll(() => coverage(page)).toEqual({ aligned: 0, painted: 0, words: 2 });

		await page.clock.runFor(PAST_TYPING_PAUSE_MS);
		await expect.poll(() => coverage(page)).toEqual({ aligned: 2, painted: 2, words: 2 });
	});

	test('a typed space rebuilds the memoized index without the batch flushing', async ({ page }) => {
		const before = await scanCount(page);

		await freezeInPageClock(page);
		await page.keyboard.type(' ');

		await expect.poll(() => scanCount(page)).toBe(before + 1);
	});
});

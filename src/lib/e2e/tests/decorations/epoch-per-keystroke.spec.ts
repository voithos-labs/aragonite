import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';

/**
 * The edit epoch follows the keystroke (requirements/decorations/epoch-per-keystroke.md).
 * The clock is frozen after setup, so the typing batch's pause never elapses and only a
 * per-change epoch can move the marks.
 */

const WORD = 'alpha';
const OCCURRENCE = '.decoration-overlay.hl-occurrence';

interface Probe {
	/** Occurrences of the word in block [0] whose live Range rect an overlay covers. */
	aligned: number;
	/** Overlays painted in block [0] — a stale mark measures into extra fragments. */
	painted: number;
	words: number;
	/** Left edge of each occurrence, the liveness half of the oracle. */
	wordLefts: number[];
}

/** Measures each painted overlay against the word's OWN rect, so the oracle is the
 *  document's live geometry rather than a remembered pixel. */
function probe(page: Page): Promise<Probe> {
	return page.evaluate((word) => {
		const block = document.querySelector("[data-block-path='[0]']");
		const editable = block?.querySelector('[contenteditable]') as HTMLElement | null;
		if (!editable) throw new Error('probe: no editable in block [0]');

		// Ambient marker spans contribute to textContent but not to raw, and the marks
		// address raw — the same reject `pointForOffset` applies.
		const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) =>
				(n as Text).parentElement?.closest('.md-marker[contenteditable="false"]')
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT
		});
		const runs: { node: Node; at: number }[] = [];
		let text = '';
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			runs.push({ node: n, at: text.length });
			text += n.textContent ?? '';
		}
		const locate = (index: number) => {
			let run = runs[0];
			for (const candidate of runs) if (candidate.at <= index) run = candidate;
			return { node: run.node, offset: index - run.at };
		};

		const wordRects: DOMRect[] = [];
		for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + word.length)) {
			const range = document.createRange();
			const start = locate(i);
			const end = locate(i + word.length);
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
			wordRects.push(range.getBoundingClientRect());
		}
		const overlays = [...block!.querySelectorAll('.decoration-overlay.hl-occurrence')].map((el) =>
			el.getBoundingClientRect()
		);
		const covers = (o: DOMRect, w: DOMRect) =>
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

// A fixed instant rather than the wall clock (G4.48), advanced one second so a timer armed
// during setup settles before the page stops ticking.
const FROZEN_AT = new Date('2026-01-01T00:00:00Z');
const FROZEN_UNTIL = new Date('2026-01-01T00:00:01Z');

/** `install` alone leaves the fake clock ticking; only the pause stops in-page timers.
 *  Playwright's own retries keep running on the runner's real clock. */
async function freezeInPageClock(page: Page): Promise<void> {
	await page.clock.install({ time: FROZEN_AT });
	await page.clock.pauseAt(FROZEN_UNTIL);
}

test.describe('decoration refresh per keystroke, not per typing batch', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('hloccur-memo');
		await editor.clickBlockAtPath([0], 0); // caret before the first 'alpha'
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);
	});

	test('a typed space moves the overlays onto the words they mark', async ({ page }) => {
		expect(await coverage(page)).toEqual({ aligned: 2, painted: 2, words: 2 });
		const [wordLeft] = (await probe(page)).wordLefts;

		// Frozen from here: no in-page timer fires again, so the typing batch never flushes.
		await freezeInPageClock(page);
		await page.keyboard.type(' ');

		// Liveness first: the word itself moved under the frozen clock, so a stationary
		// overlay below is a stale decoration rather than a page that stopped rendering.
		await expect.poll(async () => (await probe(page)).wordLefts[0]).toBeGreaterThan(wordLeft + 1);

		await expect.poll(() => coverage(page)).toEqual({ aligned: 2, painted: 2, words: 2 });
	});

	test('a typed space rebuilds the memoized index without the batch flushing', async ({ page }) => {
		const before = await scanCount(page);

		await freezeInPageClock(page);
		await page.keyboard.type(' ');

		await expect.poll(() => scanCount(page)).toBe(before + 1);
	});
});

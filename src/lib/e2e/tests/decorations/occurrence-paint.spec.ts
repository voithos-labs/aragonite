import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { freezeInPageClock } from '../../page-probes';

/**
 * What highlight-occurrences marks, measured against the painted text
 * (requirements/decorations/occurrence-paint.md): the blocks a scroll brings in, a word in a table
 * cell either way, and the edges of the typing pause, on a frozen clock.
 */

const OCCURRENCE = '.decoration-overlay.hl-occurrence';

interface Coverage {
	/** Times `word` is painted in the top-level blocks on screen. */
	words: number;
	/** Of those, the ones an overlay covers edge for edge. */
	aligned: number;
	overlays: number;
}

/** Each overlay against its word's live rect, measured off the painted text, never through the
 *  raw-to-DOM mapping the overlay paints with. */
function coverage(page: Page, word: string): Promise<Coverage> {
	return page.evaluate((needle) => {
		const test = (window as any).__test;
		const out = { words: 0, aligned: 0, overlays: 0 };
		for (const host of document.querySelectorAll('[data-block-path]')) {
			const path = JSON.parse(host.getAttribute('data-block-path')!) as number[];
			if (path.length !== 1) continue;
			const words: { left: number; right: number; top: number }[] = test.textRunRects(needle, path);
			const overlays = [...host.querySelectorAll('.decoration-overlay.hl-occurrence')].map((el) =>
				el.getBoundingClientRect()
			);
			const covers = (o: DOMRect, w: { left: number; right: number }) =>
				Math.abs(o.left - w.left) < 1.5 && Math.abs(o.right - w.right) < 1.5;
			out.words += words.length;
			out.aligned += words.filter((w) => overlays.some((o) => covers(o, w))).length;
			out.overlays += overlays.length;
		}
		return out;
	}, word);
}

const marks = (page: Page) => page.locator(OCCURRENCE).count();

test.describe('highlight-occurrences, painted where the words are', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('hloccur');
	});

	test('a scroll paints the blocks it brings in, an overlay over each word', async ({ page }) => {
		const lines = Array.from({ length: 400 }, (_, i) =>
			i % 25 === 0 ? `target at line ${i}` : `filler line ${i}`
		);
		await editor.loadContent(`${lines.join('\n\n')}\n`);
		// Every `target` on screen has one overlay over it, and no overlay stands anywhere else.
		const everyWordCovered = async () => {
			const { words, aligned, overlays } = await coverage(page, 'target');
			return words > 0 && aligned === words && overlays === words;
		};
		// Mid-document, so the short scroll below keeps the caret's block, and its word, mounted.
		await page.evaluate(() => (window as any).__test.rects.scrollTo([200], { block: 'start' }));
		await editor.waitForRenderFlush();
		await editor.clickBlockAtPath([200], 2);
		await expect.poll(everyWordCovered).toBe(true);
		const below = "[data-block-path='[250]']";
		expect(await page.locator(below).count()).toBe(0);

		const top = await page.evaluate(() => document.querySelector('.editor')!.scrollTop);
		await editor.scrollEditorTo(top + 600);
		await expect(page.locator(`${below} ${OCCURRENCE}`)).toHaveCount(1);
		await expect.poll(everyWordCovered).toBe(true);
	});

	test('a caret in a paragraph marks the word in a table cell, and one in the cell marks the paragraph', async ({
		page
	}) => {
		await editor.loadContent('a cat here\n\n| cat | dog |\n| - | - |\n| x | cat |\n\n...\n');
		const table = "[data-block-path='[1]']";
		await editor.clickBlockAtPath([0], 3);
		await expect(page.locator(`${table} ${OCCURRENCE}`)).toHaveCount(2);
		await expect.poll(() => coverage(page, 'cat')).toEqual({ words: 3, aligned: 3, overlays: 3 });

		await editor.clickBlockAtPath([2], 0); // off any word: the marks go
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);
		await editor.clickBlockAtPath([1, 0, 0], 1);
		await expect(page.locator(`[data-block-path='[0]'] ${OCCURRENCE}`)).toHaveCount(1);
		await expect.poll(() => coverage(page, 'cat')).toEqual({ words: 3, aligned: 3, overlays: 3 });
	});

	test('the first key hides the marks, and they come back once 250 ms pass', async ({ page }) => {
		await editor.clickBlockAtPath([0], 4); // before the first 'cat': three marks
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);

		await freezeInPageClock(page);
		await page.keyboard.type(' ');
		await page.clock.runFor(50);
		expect(await marks(page)).toBe(0);
		await page.clock.runFor(150);
		expect(await marks(page)).toBe(0);
		await page.clock.runFor(100);
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);
	});

	test('a new document brings them back at once, with no pause to wait out', async ({ page }) => {
		await editor.clickBlockAtPath([0], 4);
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);

		await freezeInPageClock(page);
		await page.keyboard.type(' ');
		await page.clock.runFor(50);
		expect(await marks(page)).toBe(0);
		await page.evaluate(() => (window as any).__test.setSource('cat and cat\n'));
		await page.clock.runFor(50);
		const [first] = await page.evaluate(() => (window as any).__test.textRunRects('cat', [0]));
		await page.mouse.click(first.left + 4, first.top + 4);
		await page.clock.runFor(50);
		expect(await marks(page)).toBe(2);
	});
});

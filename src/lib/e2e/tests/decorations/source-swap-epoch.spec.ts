import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';

/**
 * Decorations across a whole-document `source` swap
 * (requirements/decorations/source-swap-epoch.md): the swap is a document change,
 * so the edit epoch advances and the epoch-memoized occurrence index is rebuilt
 * against the new document. Without that, the cached index paints the previous
 * document's paths — marks in blocks that never held the word.
 */

const OCCURRENCE = '.decoration-overlay.hl-occurrence';
const blockOccurrences = (page: Page, path: number[]) =>
	page.locator(`[data-block-path='[${path.join(',')}]'] ${OCCURRENCE}`);

function scanCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__hloccurScans ?? 0);
}

test.describe('highlight-occurrences across a source-prop swap', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('hloccur-memo');
		await editor.clickBlockAtPath([0], 0); // caret on 'alpha' → the seed's three marks
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);
	});

	test('marks clear on the swap and re-paint in the new document’s blocks', async ({ page }) => {
		const before = await scanCount(page);
		await editor.loadContent('nothing here at all\n\nalpha alpha alpha\n');
		// The reset drops the selection, so the source has no anchor word to paint.
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);

		await editor.clickBlockAtPath([1], 0);
		await expect(blockOccurrences(page, [1])).toHaveCount(3);
		await expect(blockOccurrences(page, [0])).toHaveCount(0);
		expect(await scanCount(page)).toBeGreaterThan(before);
	});

	// A word the previous document never held: an index that was not rebuilt has no
	// entry for it and paints nothing, however the paths line up.
	test('a swap to a shorter document marks a word the old one never held', async ({ page }) => {
		await editor.loadContent('zeta zeta\n');
		await editor.clickBlockAtPath([0], 0);
		await expect(blockOccurrences(page, [0])).toHaveCount(2);
	});

	// A signal that fires only on the first swap, or an index that lags one document
	// behind, would paint the intermediate document's marks here.
	test('consecutive swaps each re-provide against the newest document', async ({ page }) => {
		await editor.loadContent('zeta zeta\n\nplain tail\n');
		await editor.loadContent('gamma one\n\ngamma two gamma\n');

		await editor.clickBlockAtPath([1], 0);
		await expect(blockOccurrences(page, [1])).toHaveCount(2);
		await expect(blockOccurrences(page, [0])).toHaveCount(1);
	});
});

import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { freezeInPageClock, PAST_TYPING_PAUSE_MS } from '../../page-probes';

/**
 * highlight-occurrences hardening (requirements/decorations/hloccur-memo.md). The seed wraps
 * the shipped source so it reports its index-rebuild count, making "a caret move does not
 * re-scan" a real count assertion rather than a timing guess.
 */

const OCCURRENCE = '.decoration-overlay.hl-occurrence';
const TABLE = "[data-block-path='[1]']";
const CODE = "[data-block-path='[2]']";

function scanCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__hloccurScans ?? 0);
}

/** Leaves the rebuilds have tokenized, summed over every rebuild so far. */
function tokenizedCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__hloccurTokenized ?? 0);
}

test.describe('highlight-occurrences memoized scan + capability skip', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('hloccur-memo');
	});

	test('marks every occurrence across the paragraph and the table cell, never in code', async ({
		page
	}) => {
		await editor.clickBlockAtPath([0], 0); // caret on the first 'alpha'
		// Two in the paragraph + one table-cell = three; the code block's 'alpha' is skipped.
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);
		await expect(page.locator(`${TABLE} ${OCCURRENCE}`)).toHaveCount(1);
		await expect(page.locator(`${CODE} ${OCCURRENCE}`)).toHaveCount(0);
	});

	test('a caret inside a fenced code block highlights nothing (non-prose anchor)', async ({
		page
	}) => {
		await editor.clickBlockAtPath([2], 5); // caret inside the code body 'alpha'
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);
	});

	test('a caret move re-filters the cached index without re-scanning; an edit rebuilds it', async ({
		page
	}) => {
		await editor.clickBlockAtPath([0], 0); // 'alpha' → 3 marks
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);
		const afterClick = await scanCount(page);

		// Move the caret to 'beta', a selection change and nothing more: the mark set changes,
		// but no edit happened, so the memo must not rebuild the index.
		await editor.clickBlockAtPath([0], 6);
		await expect(page.locator(OCCURRENCE)).toHaveCount(1);
		expect(await scanCount(page)).toBe(afterClick);

		// The edit counter bumps once per keystroke, not once per typing pause, so a
		// three-character burst rebuilds three times: the control proving the memo is not frozen.
		const tokenizedBefore = await tokenizedCount(page);
		await editor.typeSlowly('XYZ');
		await expect.poll(() => scanCount(page)).toBe(afterClick + 3);

		// Each of those rebuilds re-tokenized only the leaf the keystroke changed; the seed's
		// other four prose leaves came back from the token cache kept across rebuilds.
		expect(await tokenizedCount(page)).toBe(tokenizedBefore + 3);
	});

	test('the marks step aside while you type and return when the burst pauses', async ({ page }) => {
		await editor.clickBlockAtPath([0], 6); // caret on 'beta', its single occurrence
		await expect(page.locator(OCCURRENCE)).toHaveCount(1);

		// The clock is frozen after the click, not before: the harness's render-flush waits run
		// on rAF, and the typing pause must not elapse until this spec advances the clock.
		await freezeInPageClock(page);
		await editor.typeSlowly('XYZ');
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);

		await page.clock.runFor(PAST_TYPING_PAUSE_MS);
		await expect(page.locator(OCCURRENCE)).toHaveCount(1); // 'XYZbeta', its single occurrence
	});

	// The live-preview modes keep the caret, so the marks the selection drives stay painted:
	// decorations are view-only and paint outside `source` mode.
	for (const mode of ['preview-block', 'preview-inline'] as const) {
		test(`marks stay painted in ${mode} mode`, async ({ page }) => {
			await editor.clickBlockAtPath([0], 0);
			await expect(page.locator(OCCURRENCE)).toHaveCount(3);

			await page.evaluate((m) => (window as any).__test.setPresentationMode(m), mode);
			await expect(page.locator(OCCURRENCE)).toHaveCount(3);
		});
	}

	// Reading mode clears the caret, and occurrence highlighting follows the selection. Painting
	// itself still works there: a static source paints in reading mode (see mark-overlay).
	test('reading mode clears the caret-driven highlight (inert surface)', async ({ page }) => {
		await editor.clickBlockAtPath([0], 0);
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);

		await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);
	});
});

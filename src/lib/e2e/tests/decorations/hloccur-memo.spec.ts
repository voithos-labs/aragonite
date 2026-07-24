import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';

/**
 * highlight-occurrences hardening (requirements/decorations/hloccur-memo.md): the
 * epoch-memoized scan and the inline-prose capability skip, end to end. The seed
 * installs an observability wrapper over the shipped createOccurrenceSource that
 * publishes the index-rebuild count to `window.__hloccurScans`, so "a caret move
 * does not re-scan" is a real counter assertion, not a timing guess.
 */

const OCCURRENCE = '.decoration-overlay.hl-occurrence';
const TABLE = "[data-block-path='[1]']";
const CODE = "[data-block-path='[2]']";

function scanCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__hloccurScans ?? 0);
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

		// Move the caret to 'beta' — a pure selection change. The mark set changes, but
		// no edit happened, so the memo must not rebuild the index.
		await editor.clickBlockAtPath([0], 6);
		await expect(page.locator(OCCURRENCE)).toHaveCount(1);
		expect(await scanCount(page)).toBe(afterClick);

		// An edit bumps the epoch, so the index does rebuild — the positive control.
		await editor.typeSlowly('X');
		await expect.poll(() => scanCount(page)).toBeGreaterThan(afterClick);
	});

	// Live-preview modes keep the caret, so the selection-driven marks stay painted —
	// decorations are view-only and paint outside `source` mode.
	for (const mode of ['preview-block', 'preview-inline'] as const) {
		test(`marks stay painted in ${mode} mode`, async ({ page }) => {
			await editor.clickBlockAtPath([0], 0);
			await expect(page.locator(OCCURRENCE)).toHaveCount(3);

			await page.evaluate((m) => (window as any).__test.setPresentationMode(m), mode);
			await expect(page.locator(OCCURRENCE)).toHaveCount(3);
		});
	}

	// Reading mode makes the surface inert and clears the caret, so the caret-driven
	// highlight clears with it — occurrence highlighting follows the selection. (The
	// decoration paint path itself is view-only and still works in reading; a static
	// source paints there — mark-overlay coverage owns that.)
	test('reading mode clears the caret-driven highlight (inert surface)', async ({ page }) => {
		await editor.clickBlockAtPath([0], 0);
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);

		await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);
	});
});

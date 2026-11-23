import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { freezeInPageClock, PAST_OCCURRENCE_PAUSE_MS } from '../../page-probes';

/**
 * highlight-occurrences over a table cell, a code block and the presentation modes
 * (requirements/decorations/hloccur-memo.md).
 */

const OCCURRENCE = '.decoration-overlay.hl-occurrence';
const TABLE = "[data-block-path='[1]']";
const CODE = "[data-block-path='[2]']";

test.describe('highlight-occurrences over a table cell, a code block and the modes', () => {
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

	test('the marks step aside while you type and return when the burst pauses', async ({ page }) => {
		await editor.clickBlockAtPath([0], 6); // caret on 'beta', its single occurrence
		await expect(page.locator(OCCURRENCE)).toHaveCount(1);

		// The clock is frozen after the click, not before: the harness's render-flush waits run
		// on rAF, and the typing pause must not elapse until this spec advances the clock.
		await freezeInPageClock(page);
		await editor.typeSlowly('XYZ');
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);

		await page.clock.runFor(PAST_OCCURRENCE_PAUSE_MS);
		await expect(page.locator(OCCURRENCE)).toHaveCount(1); // 'XYZbeta', its single occurrence
	});

	// The live-preview modes keep the caret, so the marks the selection drives stay painted:
	// decorations are view-only and paint outside `source` mode.
	for (const mode of ['preview-block', 'preview-inline'] as const) {
		test(`marks stay painted in ${mode} mode`, async ({ page }) => {
			await editor.clickBlockAtPath([0], 0);
			await expect(page.locator(OCCURRENCE)).toHaveCount(3);

			await editor.setPresentationMode(mode);
			await expect(page.locator(OCCURRENCE)).toHaveCount(3);
		});
	}

	// Reading mode clears the caret, and occurrence highlighting follows the selection. Painting
	// itself still works there: a static source paints in reading mode (see mark-overlay).
	test('reading mode clears the caret-driven highlight (inert surface)', async ({ page }) => {
		await editor.clickBlockAtPath([0], 0);
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);

		await editor.setPresentationMode('reading');
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);
	});
});

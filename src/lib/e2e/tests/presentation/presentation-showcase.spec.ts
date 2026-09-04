import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { waitForEditorHydrated } from '../../page-probes';

// The `/` showcase's presentation-mode toggle. No `window.__test` bridge on this route —
// rendered-DOM assertions only, like showcase-route.spec.ts — and nothing here names a
// sentence of the demo document, which the owner rewrites by hand.
// Requirements: e2e/requirements/presentation/presentation-showcase.md.

// The family reading mode hides outright. Ambient list markers keep their box (a bullet
// paints in the slot), so they are `[contenteditable='false']` and not part of this.
const MARKER = ".md-marker:not([contenteditable='false'])";

/** Park at the end of the document, the one scroll position a mode flip cannot move. */
async function scrollToEnd(page: Page): Promise<void> {
	const editor = page.locator('.editor');
	for (let step = 0; step < 200; step++) {
		const settled = await editor.evaluate((el) => {
			const before = el.scrollTop;
			el.scrollTop = el.scrollHeight;
			return el.scrollTop <= before;
		});
		await page.waitForTimeout(60);
		if (settled) return;
	}
}

test.describe('/ showcase presentation toggle', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// The route SSRs: a click on painted-but-unhydrated chrome reaches no handler.
		await waitForEditorHydrated(page);
	});

	test('reading hides markers, keeps rendered widgets; source restores', async ({ page }) => {
		const editor = page.locator('.editor');
		// The tour's inline widgets sit well below the fold, and "widgets survived the flip"
		// asserted where none are mounted is the vacuity this scenario exists to avoid.
		await scrollToEnd(page);
		const widgets = page.locator('[data-inline-widget]');
		await expect
			.poll(() => widgets.count(), {
				message: 'the demo document mounts no inline widget'
			})
			.toBeGreaterThan(0);
		await expect(page.locator(`${MARKER}:visible`).first()).toBeVisible();
		const before = await mountedBlockText(page);

		await page.locator('.showcase-mode[data-mode="reading"]').click();
		await expect(editor).toHaveAttribute('data-presentation', 'reading');
		await expect(page.locator(`${MARKER}:visible`)).toHaveCount(0);
		await expect.poll(() => widgets.count()).toBeGreaterThan(0);

		await page.locator('.showcase-mode[data-mode="source"]').click();
		await expect(editor).not.toHaveAttribute('data-presentation');
		await expect(page.locator(`${MARKER}:visible`).first()).toBeVisible();
		// Hiding markers shortens the document, so the window after the round trip need not be
		// the window before it: compare block by block over the blocks mounted both times.
		await scrollToEnd(page);
		await expect
			.poll(async () => {
				const after = await mountedBlockText(page);
				const shared = Object.keys(before).filter((path) => path in after);
				const drifted = shared.filter((path) => after[path] !== before[path]);
				return { shared: shared.length, drifted };
			})
			.toEqual({ shared: expect.any(Number), drifted: [] });
		const after = await mountedBlockText(page);
		expect(Object.keys(before).filter((path) => path in after).length).toBeGreaterThan(4);
	});
});

/** Text per mounted block, keyed by path: a windowed editor's text is only its mounted slice. */
function mountedBlockText(page: Page): Promise<Record<string, string>> {
	return page.evaluate(() =>
		Object.fromEntries(
			Array.from(document.querySelectorAll('.block-host[data-block-path]')).map((host) => [
				host.getAttribute('data-block-path') ?? '',
				host.textContent ?? ''
			])
		)
	);
}

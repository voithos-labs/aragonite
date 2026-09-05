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
		const before = await settledBlockText(page);

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
				// Both texts, not just the path: which block moved is not the same question as
				// whether it rendered differently or was read mid-frame (#280).
				const drifted = shared
					.filter((path) => after[path] !== before[path])
					.map((path) => `${path} ${trim(before[path])} -> ${trim(after[path])}`);
				return { shared: shared.length, drifted };
			})
			.toEqual({ shared: expect.any(Number), drifted: [] });
		const after = await mountedBlockText(page);
		expect(Object.keys(before).filter((path) => path in after).length).toBeGreaterThan(4);
	});
});

/** Chrome a renderer mounts while it is still working. A sample taken over one of these is a
 *  sample of a half-rendered document, which the flip would then be blamed for. */
const PENDING_RENDER = '.mermaid-loading';

/**
 * The mounted text once nothing is still rendering and two consecutive reads agree. An async
 * renderer that finishes between the flip's two samples reads as a block the flip changed, which
 * is the one difference this comparison must not see. Both conditions are checked on the same
 * pass: a diagram sits on a perfectly stable placeholder while it fetches its renderer, and
 * before it mounts at all there is no placeholder to find.
 */
async function settledBlockText(page: Page): Promise<Record<string, string>> {
	let previous = await mountedBlockText(page);
	for (let attempt = 0; attempt < 200; attempt++) {
		await page.waitForTimeout(100);
		const next = await mountedBlockText(page);
		const pending = await page.locator(PENDING_RENDER).count();
		if (pending === 0 && JSON.stringify(next) === JSON.stringify(previous)) return next;
		previous = next;
	}
	throw new Error('the showcase document never settled: a block is still rendering');
}

/** One block's text, short enough to read in a failure message. */
const trim = (text: string) =>
	JSON.stringify(text.length > 80 ? `${text.slice(0, 40)}…${text.slice(-40)}` : text);

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

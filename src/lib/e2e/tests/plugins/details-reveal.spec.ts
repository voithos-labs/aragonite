import { test, expect } from '../../fixtures';
import { primaryModifier } from '../../platform';
import { DetailsPage, activeBlockPath, bodyHostCount, capturedErrors } from './details-helpers';

/**
 * The reveal-into-collapsed degrade (spec §4). Searching for text that lives in a
 * clamped-out body child drives the real reveal path
 * (`revealPath` → container `revealByPath` → `revealChildOrWait`) against a
 * collapsed details. This e2e is NOT the no-hang proof: it stays green with the
 * `isInWindow` clamp neutered, because the render-window and `revealChild` clamps
 * enforce these assertions on their own. The no-hang seam (a reveal into a body the
 * collapse clamp can never mount must terminate, not await a mount forever — VR-5)
 * is unit-covered — the collapse clamp in `list-windowing-collapse.svelte.test.ts`
 * and reveal termination in `reveal-child-or-wait.test.ts`. What this gate proves is
 * the OBSERVABLE, non-mutating degrade on the real search path: the reveal neither
 * mounts the body nor mutates `open` (auto-expand is rejected — reveal must never
 * edit the document), and the summary stays the sole accessible surface.
 */

// A closed details whose body holds a needle found only there, plus a sibling
// below. Search scans the CST, so it finds the body text even while unmounted.
const CLOSED_WITH_NEEDLE =
	'<details>\n<summary>Sum</summary>\n\nZebra body text\n\n</details>\n\nBelow\n';

test.describe('plugin container: <details> reveal-into-collapsed degrade', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('search navigation into a collapsed body degrades to the summary without mutating open', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_NEEDLE);
		// Precondition: the body child is genuinely clamped out, so a reveal that
		// force-mounted it (the pre-clamp hang path) would be observable here.
		expect(await bodyHostCount(page)).toBe(1);
		expect(
			await page.evaluate(() =>
				document.querySelector(`[data-block-path='${JSON.stringify([0, 1])}']`)
			)
		).toBeNull();

		// Caret on the summary before Ctrl+F, so the search snapshots it and the
		// on-close restore has a live, in-DOM target to land on.
		await editor.focusBlockAtPath([0, 0], 3);
		await page.keyboard.press(`${primaryModifier}+f`);
		await page.getByRole('textbox', { name: 'Find' }).click();
		await page.keyboard.type('Zebra');

		// The needle is found (the scan reaches the unmounted body), so the reveal
		// of [0, 1] was genuinely attempted — the count proves the path ran, not
		// that it hung (rescan is synchronous; the reveal is fire-and-forget).
		await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*1/);

		// The negative asserts below (body unmounted, `open` unflipped) all hold
		// BEFORE the reveal fires too, so a buggy auto-expand landing a tick late
		// would slip through a pre==post check. Settle two render frames past the
		// fire-and-forget reveal so a late mutation would be visible here.
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		// The degrade: the clamp held — the body was NOT mounted by the reveal, and
		// `open` was NOT flipped (still `<details>`, aria-expanded false).
		expect(await bodyHostCount(page)).toBe(1);
		expect(
			await page.evaluate(() =>
				document.querySelector(`[data-block-path='${JSON.stringify([0, 1])}']`)
			)
		).toBeNull();
		expect(await editor.bridge.getSource()).toBe(CLOSED_WITH_NEEDLE);
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');

		// Close search: focus returns to the summary (its node is still in the DOM),
		// proving the degrade left the summary as the accessible caret target.
		await page.keyboard.press('Escape');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);

		// The editor is not wedged after the degrade: the restored summary caret is
		// live and takes an edit (which touches only the summary bytes, not `open`).
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('<summary>Sum!</summary>');
		expect(await editor.bridge.getSource()).toContain('<details>\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

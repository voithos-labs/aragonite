import { test, expect } from '../../fixtures';
import { DetailsPage, activeBlockPath, bodyHostCount, capturedErrors } from './details-helpers';

/**
 * Reveal into a collapsed body from the search side: the caret half. Searching for text in a
 * clamped-out body child drives the real reveal path against a collapsed details, which opens its
 * expand door and commits it. NOT the no-hang proof (VR-5) — that is unit-covered in
 * `list-windowing-collapse.svelte.test.ts` and `reveal-child-or-wait.test.ts`. What this proves is
 * that the expansion leaves a LIVE editor behind it (bytes + undo: details-reveal-expand.spec.ts).
 */

// A closed details whose body holds a needle found only there, plus a sibling below.
// Search scans the CST, so it finds the body text even while unmounted.
const CLOSED_WITH_NEEDLE =
	'<details>\n<summary>Sum</summary>\n\nZebra body text\n\n</details>\n\nBelow\n';

test.describe('plugin container: <details> reveal-into-collapsed', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
	});

	test('search navigation into a collapsed body expands it and leaves a live caret', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_NEEDLE);
		// Precondition: the body child is genuinely clamped out, so the reveal below has
		// to open the container rather than finding its target already mounted.
		expect(await bodyHostCount(page)).toBe(1);
		expect(
			await page.evaluate(() =>
				document.querySelector(`[data-block-path='${JSON.stringify([0, 1])}']`)
			)
		).toBeNull();

		// Caret on the summary before Ctrl+F, so the search snapshots it and the on-close
		// restore has a live, in-DOM target to land on.
		await editor.focusBlockAtPath([0, 0], 3);
		await page.keyboard.press('ControlOrMeta+f');
		await page.getByRole('textbox', { name: 'Find' }).click();
		await page.keyboard.type('Zebra');

		// The needle is found (the scan reaches the unmounted body), so the reveal of [0, 1] was
		// genuinely attempted — the count proves the path ran, not that it hung (rescan is
		// synchronous; the reveal is fire-and-forget).
		await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*1/);

		// The expand door opened and committed: the body child mounts and `open` is now
		// in the serialized bytes.
		await editor.bridge.waitForSourceContains('<details open>');
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		await expect
			.poll(() =>
				page.evaluate(
					() => document.querySelector(`[data-block-path='${JSON.stringify([0, 1])}']`) != null
				)
			)
			.toBe(true);

		// Close search: focus returns to the summary (its node is still in the DOM),
		// proving the expansion left the summary as the accessible caret target.
		await page.keyboard.press('Escape');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);

		// The editor is not wedged after the reveal: the restored summary caret is live
		// and takes an edit (which touches only the summary bytes).
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('<summary>Sum!</summary>');
		// The expansion survives that edit: `rebuildDetailsRaw` regenerates the opener line from
		// metadata on every child write, so a summary keystroke is exactly where a committed `open`
		// would silently be rebuilt away.
		expect(await editor.bridge.getSource()).toContain('<details open>\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

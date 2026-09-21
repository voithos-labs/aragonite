import { test, expect } from '../../fixtures';
import { DetailsPage, activeBlockPath, bodyHostCount, capturedErrors } from './details-helpers';

/**
 * Scrolling into a collapsed body from the search side: the caret half. Searching for text in an
 * unmounted body child drives the real path against a collapsed details, which expands and commits
 * that. It is not the proof that nothing hangs (VR-5), which is covered by
 * `list-windowing-collapse.svelte.test.ts` and `reveal-child-or-wait.test.ts`. What it proves is
 * that the expansion leaves a working editor behind; the bytes and undo are in
 * details-reveal-expand.spec.ts.
 */

// A closed details whose body holds a word found only there, plus a sibling below. Search scans
// the CST, so it finds the body text even while that text is unmounted.
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
		// Precondition: the body child really is unmounted, so the step below has to open the
		// container rather than find its target already there.
		expect(await bodyHostCount(page)).toBe(1);
		expect(
			await page.evaluate(() =>
				document.querySelector(`[data-block-path='${JSON.stringify([0, 1])}']`)
			)
		).toBeNull();

		// Caret on the summary before Ctrl+F, so the search saves it and the restore on close has
		// a live element in the DOM to land on.
		await editor.focusBlockAtPath([0, 0], 3);
		await page.keyboard.press('ControlOrMeta+f');
		await page.getByRole('textbox', { name: 'Find' }).click();
		await page.keyboard.type('Zebra');

		// The word is found, since the scan reaches the unmounted body, so mounting [0, 1] was
		// really attempted. The count proves the path ran, not that it finished: the rescan is
		// synchronous and the mount is not awaited.
		await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*1/);

		// The container expanded and committed: the body child mounts and `open` is in the
		// serialized bytes.
		await editor.bridge.waitForSourceContains('<details open>');
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		await expect
			.poll(() =>
				page.evaluate(
					() => document.querySelector(`[data-block-path='${JSON.stringify([0, 1])}']`) != null
				)
			)
			.toBe(true);

		// Close search: focus returns to the summary, whose element is still in the DOM, which
		// shows the expansion left the summary reachable by the caret.
		await page.keyboard.press('Escape');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);

		// The editor is not stuck afterwards: the restored summary caret is live and takes an
		// edit, which touches only the summary's bytes.
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('<summary>Sum!</summary>');
		// The expansion survives that edit: `rebuildDetailsRaw` regenerates the opener line from
		// metadata on every child write, so a summary keystroke is exactly where a committed `open`
		// would silently be rebuilt away.
		expect(await editor.bridge.getSource()).toContain('<details open>\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

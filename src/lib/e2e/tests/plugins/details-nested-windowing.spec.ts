import { test, expect } from '../../fixtures';
import {
	DetailsPage,
	readDetails,
	bodyHostCount,
	detailsSpacerCount,
	capturedErrors,
	auditRealDesyncs
} from './details-helpers';

/**
 * Nested windowing together with the collapse clamp (`virtual-rendering.md` § Nesting,
 * `plugin-contract.md` § Collapsible containers). A details whose body has enough
 * children to window on its own, toggled closed, open, closed. The clamp and the nested window
 * share the same slicing, so the risks are the CST and the mounted references drifting apart as
 * children come and go, and the remounted children's measurements sticking in `pending` on
 * re-expand. Both must stay clean, and the CST child count never depends on windowing.
 */

// One details with a body large enough to clear the ~4000px nested-window threshold: each short
// child is about one line plus its frame, near 40px, so 200 of them run to about 8000px.
function bigDetails(open: boolean): string {
	const body = Array.from({ length: 200 }, (_, i) => `Body paragraph ${i} lorem ipsum dolor`).join(
		'\n\n'
	);
	return `<details${open ? ' open' : ''}>\n<summary>Big Summary</summary>\n\n${body}\n\n</details>\n`;
}

const CHILD_COUNT = 201; // summary + 200 body paragraphs

test.describe('plugin container: <details> nested windowing × clamp', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
	});

	test('toggling a nested-windowed details closed→open→closed keeps CST and refs in sync', async ({
		page
	}) => {
		await editor.loadContent(bigDetails(true));

		// Open: the body windows its own children, with spacers inside the box and only part of
		// the 200 body hosts mounted. Without this the clamp assertions below would prove nothing,
		// since a small body that mounts in full never windows at all.
		expect(await detailsSpacerCount(page)).toBeGreaterThan(0);
		const openHosts = await bodyHostCount(page);
		expect(openHosts).toBeGreaterThan(1);
		expect(openHosts).toBeLessThan(CHILD_COUNT);
		expect((await readDetails(page, 0)).childCount).toBe(CHILD_COUNT);
		expect(await auditRealDesyncs(page)).toEqual([]);

		// Closed: the clamp collapses the body to the summary row and every body child unmounts,
		// while the CST stays intact. The clamped window is active with zero-height spacers, so
		// the host count, not the spacer count, is what proves what is mounted.
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		await expect.poll(() => bodyHostCount(page)).toBe(1);
		expect((await readDetails(page, 0)).childCount).toBe(CHILD_COUNT);
		expect(await auditRealDesyncs(page)).toEqual([]);

		// Open again: the body remounts and windows again, with the first body child really back
		// in the DOM and holding its text. A stuck measurement would leave the reopened part
		// unmeasured rather than unmounted.
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details open>');
		await expect.poll(() => detailsSpacerCount(page)).toBeGreaterThan(0);
		expect(await bodyHostCount(page)).toBeGreaterThan(1);
		expect(
			await page.evaluate(
				() => document.querySelector(`[data-block-path='${JSON.stringify([0, 1])}']`)?.textContent
			)
		).toContain('Body paragraph 0');
		expect(await auditRealDesyncs(page)).toEqual([]);

		// Closed once more: the clamp re-engages cleanly a second time.
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		await expect.poll(() => bodyHostCount(page)).toBe(1);
		expect((await readDetails(page, 0)).childCount).toBe(CHILD_COUNT);
		expect(await auditRealDesyncs(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

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
 * Spec §8.2 — nested windowing × the collapse clamp. A details whose body has enough children to
 * activate its OWN nested windowing, toggled closed → open → closed. The clamp and the nested
 * window share the same slice machinery, so the risks are a CST/ref desync as children churn in and
 * out of the mounted set, and the remounted children's measurements stranding in `pending` on
 * re-expand. Both must stay clean, and the CST child count is windowing-independent throughout.
 */

// One details with a body large enough to clear the ~4000px nested-window
// watermark (each short child ≈ one line + chrome ≈ 40px; 200 ≈ 8000px).
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

		// Open: the body windows its own children — spacers inside the box, and only a slice of the
		// 200 body hosts mounted. Without this the clamp assertions below would prove nothing (a
		// fully-mounted small body never exercises §8.2).
		expect(await detailsSpacerCount(page)).toBeGreaterThan(0);
		const openHosts = await bodyHostCount(page);
		expect(openHosts).toBeGreaterThan(1);
		expect(openHosts).toBeLessThan(CHILD_COUNT);
		expect((await readDetails(page, 0)).childCount).toBe(CHILD_COUNT);
		expect(await auditRealDesyncs(page)).toEqual([]);

		// Closed: the clamp collapses the body to the summary row — every body child unmounts — but
		// the CST is intact. The clamp window is active with zero-height spacers, so the host
		// count, not the spacer count, is the mount proof.
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		await expect.poll(() => bodyHostCount(page)).toBe(1);
		expect((await readDetails(page, 0)).childCount).toBe(CHILD_COUNT);
		expect(await auditRealDesyncs(page)).toEqual([]);

		// Open again: the body remounts and re-windows, with the first body child genuinely back in
		// the DOM and carrying its text (the stranded-measurement trap would leave the re-expanded
		// slice unmeasured, not unmounted).
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

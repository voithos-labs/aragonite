import { test, expect } from '../fixtures';
import { waitForEditorHydrated } from '../page-probes';

// The `/changelog` route at phone width, where the header's one unwrappable row put the older
// release families, both mode chips and the link past the right edge with no pan to bring them
// back. The pinned 1280 viewport sees a row that fits. Everything else about the route lives in
// plugins/changelog-route.spec.ts. Requirements: e2e/requirements/mobile-changelog.md.

const PHONE = { width: 320, height: 640 };

// The first release family, so no future one can take its place at the end of the picker.
const OLDEST = '0.1';
// Anchored, and read once before the tap: the newest family's title carries this one's as a
// prefix, so an unanchored match passes on either document. `toHaveText` leaves the heading's
// trailing marker space in the string it matches, hence the `\s*`.
const OLDEST_TITLE = /Changelog 0\.1\s*$/;

test.use({ viewport: PHONE, hasTouch: true });

test.describe('/changelog on a phone', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/changelog');
		await waitForEditorHydrated(page);
		await expect(page.locator('.block-host').first()).toBeVisible();
	});

	test('neither the page nor the header pans sideways', async ({ page }) => {
		// Polled, not read once: the mounted window grows as blocks land, so a single sample
		// can precede the widest one.
		await expect
			.poll(() =>
				page.evaluate(() => {
					const header = document.querySelector('.changelog-header') as HTMLElement;
					return {
						pagePan: document.documentElement.scrollWidth - window.innerWidth,
						headerPan: header.scrollWidth - header.clientWidth
					};
				})
			)
			.toEqual({ pagePan: 0, headerPan: 0 });
	});

	test('every chip and the showcase link lies inside the viewport', async ({ page }) => {
		const targets = page.locator('.changelog-chip, .changelog-link');
		// A floor, not a count: release families only ever get added.
		expect(await targets.count(), 'the header census matched nothing').toBeGreaterThanOrEqual(13);

		const offscreen = await targets.evaluateAll(
			(els, width) =>
				els
					.map((el) => ({ label: el.textContent?.trim() ?? '', box: el.getBoundingClientRect() }))
					.filter(({ box }) => box.left < 0 || box.right > width)
					.map(({ label }) => label),
			PHONE.width
		);
		expect(offscreen).toEqual([]);
	});

	test('a tap on the oldest family chip swaps the document', async ({ page }) => {
		const heading = page.locator('[data-block-kind="heading"]').first();
		const active = page.locator('.changelog-family.active');
		await expect(active).not.toHaveAttribute('data-family', OLDEST);
		await expect(heading).not.toHaveText(OLDEST_TITLE);

		await page.locator(`.changelog-family[data-family="${OLDEST}"]`).tap();

		await expect(active).toHaveAttribute('data-family', OLDEST);
		await expect(heading).toHaveText(OLDEST_TITLE);
	});

	test('every chip and the link clears the thumb minimum', async ({ page }) => {
		// WCAG 2.2 AA (2.5.8), not the 44px HIG figure: the header carries a chip per release
		// family, and 44 apiece costs the document more rows than the condensed header saves.
		const sides = await page.locator('.changelog-chip, .changelog-link').evaluateAll((els) =>
			els.map((el) => {
				const box = el.getBoundingClientRect();
				return Math.min(box.width, box.height);
			})
		);
		expect(sides.length).toBeGreaterThanOrEqual(13);
		expect(Math.min(...sides)).toBeGreaterThanOrEqual(24);
	});

	test('the open outline entries clear the thumb minimum', async ({ page }) => {
		await page.locator('.details-toggle').tap();
		const entries = page.locator('.toc-block-item');
		await expect(entries.first()).toBeVisible();

		const heights = await entries.evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().height)
		);
		expect(heights.length).toBeGreaterThan(1);
		expect(Math.min(...heights)).toBeGreaterThanOrEqual(24);
	});
});

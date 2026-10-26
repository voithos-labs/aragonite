import { test, expect } from '../fixtures';
import { gotoReady } from '../goto-ready';
import { skipUnlessSupported } from '../browser-engine';
import type { Locator, Page } from '@playwright/test';

// The `/changelog` route at phone width, where the release families fold into one chip and its
// list, and a bar that could not fit would push the way back or the theme switch past the right
// edge. Everything else about the route is in plugins/changelog-route.spec.ts. Requirements:
// e2e/requirements/mobile-changelog.md.

const PHONE = { width: 320, height: 640 };

// The first release family, so no later one can take its place at the end of the list.
const OLDEST = '0.1';
// Anchored, since the newest family's title starts with this one's; `toHaveText` keeps the space
// after the heading's marker, hence the `\s*`.
const OLDEST_TITLE = /Changelog 0\.1\s*$/;

/** Every link and button the header shows, an open family list's options included. */
function controls(page: Page): Locator {
	return page.locator('.changelog-header :is(a, button):visible');
}

/** The labels of the controls in `targets` that are not wholly on screen. */
function offscreen(targets: Locator): Promise<string[]> {
	return targets.evaluateAll(
		(els, { width, height }) =>
			els
				.map((el) => ({
					label: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
					box: el.getBoundingClientRect()
				}))
				.filter(({ box }) => box.left < 0 || box.right > width || box.bottom > height)
				.map(({ label }) => label),
		PHONE
	);
}

test.use({ viewport: PHONE, hasTouch: true });

test.describe('/changelog on a phone', () => {
	test.beforeEach(async ({ page }) => {
		await gotoReady(page, '/changelog');
		await expect(page.locator('.block-host').first()).toBeVisible();
	});

	test('neither the page nor the header pans sideways', async ({ page }) => {
		// Polled rather than read once: more blocks mount as the page settles, so a single
		// measurement can come before the widest one arrives.
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

	test('the wordmark, the family chip, the showcase link and the theme switch lie on screen', async ({
		page
	}) => {
		await expect(page.locator('.changelog-family-trigger')).toBeVisible();
		await expect(page.locator('.changelog-link')).toBeVisible();
		await expect(page.getByTestId('theme-toggle')).toBeVisible();
		expect(
			await controls(page).count(),
			'the header census matched nothing'
		).toBeGreaterThanOrEqual(4);
		expect(await offscreen(controls(page))).toEqual([]);
	});

	test('the family chip lists every family on screen and a tap swaps the document', async ({
		page
	}) => {
		skipUnlessSupported(page, 'touch');
		const heading = page.locator('[data-block-kind="heading"]').first();
		const trigger = page.locator('.changelog-family-trigger');
		await expect(trigger).not.toHaveAccessibleName(`Release family: ${OLDEST}`);
		await expect(heading).not.toHaveText(OLDEST_TITLE);

		await trigger.tap();
		const options = page.locator('.changelog-family-option');
		// A floor, since families only get added; counted first, so the on-screen check below
		// cannot pass on a list that never opened.
		await expect.poll(() => options.count()).toBeGreaterThanOrEqual(11);
		expect(await offscreen(options)).toEqual([]);

		await page.locator(`.changelog-family-option[data-family="${OLDEST}"]`).tap();
		await expect(options).toHaveCount(0);
		await expect(trigger).toHaveAccessibleName(`Release family: ${OLDEST}`);
		await expect(heading).toHaveText(OLDEST_TITLE);
	});

	test('every header control and family option clears the thumb minimum', async ({ page }) => {
		skipUnlessSupported(page, 'touch');
		// WCAG 2.2 AA (2.5.8), the 24px minimum the rest of the demo's phone layout holds to.
		await page.locator('.changelog-family-trigger').tap();
		await expect(page.locator('.changelog-family-option').first()).toBeVisible();

		const sides = await controls(page).evaluateAll((els) =>
			els.map((el) => {
				const box = el.getBoundingClientRect();
				return Math.min(box.width, box.height);
			})
		);
		expect(sides.length).toBeGreaterThanOrEqual(15);
		expect(Math.min(...sides)).toBeGreaterThanOrEqual(24);
	});

	test('the open outline entries clear the thumb minimum', async ({ page }) => {
		skipUnlessSupported(page, 'touch');
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

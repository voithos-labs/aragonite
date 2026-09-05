import { test, expect } from '../../fixtures';
import { waitForEditorHydrated } from '../../page-probes';
import { findInput } from '../search/helpers';
import type { Page } from '@playwright/test';

// The `/changelog` dogfood route renders the repo's own changelog, one release family per
// document, behind a route-prepended `[[toc]]` inside a collapsed `<details>`, under all nine
// bundled plugins. No `window.__test` bridge, so this smoke asserts through rendered DOM only. The
// shared fixture also fails on any `[invariant:…]` console fire, so a green run additionally
// proves the changelog loads without tripping an invariant under all nine plugins. Requirements:
// e2e/requirements/plugins/changelog-route.md.

// The `<details>` opener bytes, read off the live document the route registers for the parity
// walk — with no probe bridge on this route it is the only byte-level read available, and the
// opener is exactly where a committed disclosure flip would land.
function outlineRaw(page: Page): Promise<string> {
	return page.evaluate(() => {
		const registry = (
			window as { __parityDocuments?: Array<() => { children?: Array<{ raw?: string }> }> }
		).__parityDocuments;
		return registry?.[0]()?.children?.[0]?.raw ?? '';
	});
}

test.describe('/changelog route', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/changelog');
		await waitForEditorHydrated(page);
		await expect(page.locator('.block-host').first()).toBeVisible();
	});

	test("renders the repo's changelog under a collapsed outline", async ({ page }) => {
		// The family file's own title, not a version number: the one landmark a release cannot
		// move. Reading mode hides the `#` marker with `display: none`, so it stays in textContent.
		await expect(page.locator('[data-block-kind="heading"]').first()).toContainText('Changelog');
		// A floor well below the mounted window, robust to it shifting.
		await expect.poll(() => page.locator('.block-host').count()).toBeGreaterThan(5);

		// Collapsed by default: the reader lands on the newest entry, not on a version index.
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('.toc-block-item')).toHaveCount(0);
	});

	test('clicking the outline scrolls a windowed-out version heading into view', async ({
		page
	}) => {
		const entries = page.locator('.toc-block-item');
		// A first-release family is one short entry that windows nothing out, so pick the
		// family with the longest outline at runtime — the precondition needs a tall document.
		const chips = page.locator('.changelog-family');
		const chipCount = await chips.count();
		let tallest = 0;
		let tallestEntries = 0;
		for (let i = 0; i < chipCount; i++) {
			await chips.nth(i).click();
			await page.locator('.details-toggle').click();
			await expect(entries.first()).toBeVisible();
			const n = await entries.count();
			if (n > tallestEntries) {
				tallestEntries = n;
				tallest = i;
			}
		}
		await chips.nth(tallest).click();
		await page.locator('.details-toggle').click();
		await expect(entries.first()).toBeVisible();
		await expect.poll(() => entries.count()).toBeGreaterThan(1);

		// The oldest section, read at runtime so a new release entry cannot stale the spec.
		const oldest = entries.last();
		const label = (await oldest.textContent())?.trim() ?? '';
		// A blank label would make the windowed-out precondition below vacuously true.
		expect(label).not.toBe('');
		const heading = page.locator('[data-block-kind="heading"]', { hasText: label });
		// Precondition: the tail is windowed out, so the click exercises reveal, not just scroll.
		await expect(heading).toHaveCount(0);

		await oldest.click();
		await expect(heading).toBeInViewport();
	});

	test('expanding the outline in reading mode moves no bytes', async ({ page }) => {
		const before = await outlineRaw(page);
		expect(before.startsWith('<details>\n')).toBe(true);

		await page.locator('.details-toggle').click();
		// The body genuinely mounted — the half `aria-expanded` alone would fake.
		await expect(page.locator('.toc-block-item').first()).toBeVisible();

		expect(await outlineRaw(page)).toBe(before);
	});

	test('the family picker swaps the document to another release family', async ({ page }) => {
		const heading = page.locator('[data-block-kind="heading"]').first();
		const active = page.locator('.changelog-family.active');
		const current = (await active.getAttribute('data-family')) ?? '';
		await expect(heading).toContainText(`Changelog ${current}`);

		// The oldest family, read at runtime so a new family file cannot stale the spec.
		const oldest = page.locator('.changelog-family').last();
		const target = (await oldest.getAttribute('data-family')) ?? '';
		expect(target).not.toBe(current);

		await oldest.click();
		await expect(heading).toContainText(`Changelog ${target}`);
		// The outline serves the document on screen, not the one it was first built for.
		await page.locator('.details-toggle').click();
		await expect(page.locator('.toc-block-item').first()).toContainText(target);
	});

	test('the Find chord opens the search bar over the reading-mode document', async ({ page }) => {
		// Reading mode parks no caret in a block, so the chord reaches the sole mounted editor
		// through its body-chord claim rather than through a focused surface.
		await page.keyboard.press('ControlOrMeta+f');
		await expect(findInput(page)).toBeFocused();
	});

	test('the header toggle flips the document between reading and source', async ({ page }) => {
		const editor = page.locator('.editor');
		const marker = page.locator('.text-editable-block .md-marker').first();
		await expect(editor).toHaveAttribute('data-presentation', 'reading');
		await expect(marker).toBeHidden();

		await page.locator('.changelog-mode[data-mode="source"]').click();
		await expect(editor).not.toHaveAttribute('data-presentation');
		await expect(marker).toBeVisible();

		await page.locator('.changelog-mode[data-mode="reading"]').click();
		await expect(editor).toHaveAttribute('data-presentation', 'reading');
		await expect(marker).toBeHidden();
	});

	test('the header link navigates back to the showcase', async ({ page }) => {
		// `resolve()` under a configured base path: a wrong href lands on a 404 with the URL
		// still looking plausible, so the destination's own chrome is the real assertion.
		await page.locator('.changelog-link').click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByTestId('theme-toggle')).toBeVisible();
	});
});

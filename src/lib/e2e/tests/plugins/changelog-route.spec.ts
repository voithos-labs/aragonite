import { test, expect } from '../../fixtures';
import { gotoReady, gotoUnhydrated } from '../../goto-ready';
import { findInput } from '../search/helpers';
import type { Page } from '@playwright/test';
import { clickInPlace } from '../../click-in-place';
import { clickShowcaseSetting } from '../../showcase-settings';

// The `/changelog` route renders the repo's changelog, one release family per document, behind a
// prepended `[[toc]]` inside a collapsed `<details>`, under all nine bundled plugins. The route has
// no `window.__test` bridge, so assertions read the rendered DOM; the shared fixture's console
// watch also proves the changelog loads without tripping an invariant.

// The `<details>` opener bytes, read from the live document the route registers for the parity
// check: the only byte-level read this route offers, and where a committed disclosure lands.
function outlineRaw(page: Page): Promise<string> {
	return page.evaluate(() => {
		const registry = (
			window as { __parityDocuments?: Array<() => { children?: Array<{ raw?: string }> }> }
		).__parityDocuments;
		return registry?.[0]()?.children?.[0]?.raw ?? '';
	});
}

// The page around the editor, read as light or dark from its background's luminance; `unstyled`
// while no stylesheet has painted it, so a transparent wrapper never reads as dark.
function pageTheme(page: Page, wrapper: string): Promise<'light' | 'dark' | 'unstyled'> {
	return page.locator(wrapper).evaluate((el) => {
		const [r, g, b, alpha = 1] = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(
			Number
		);
		if (r === undefined || alpha === 0) return 'unstyled';
		return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light';
	});
}

async function expectTheme(page: Page, wrapper: string, theme: 'light' | 'dark'): Promise<void> {
	await expect(page.locator(`${wrapper} .editor`)).toHaveAttribute('data-editor-theme', theme);
	await expect.poll(() => pageTheme(page, wrapper)).toBe(theme);
}

test.describe('/changelog route', () => {
	test.beforeEach(async ({ page }) => {
		await gotoReady(page, '/changelog');
		await expect(page.locator('.block-host').first()).toBeVisible();
	});

	test("renders the repo's changelog under a collapsed outline", async ({ page }) => {
		// The family file's own title, not a version number: the one landmark a release cannot
		// move. Reading mode hides the `#` marker with `display: none`, so it stays in textContent.
		await expect(page.locator('[data-block-kind="heading"]').first()).toContainText('Changelog');
		await expect(page.locator('.editor')).toHaveAttribute('data-presentation', 'reading');
		// A floor well below the mounted window, robust to it shifting.
		await expect.poll(() => page.locator('.block-host').count()).toBeGreaterThan(5);

		// Collapsed by default: the user lands on the newest entry, not on a version index.
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('.toc-block-item')).toHaveCount(0);
	});

	test('clicking the outline scrolls a windowed-out version heading into view', async ({
		page
	}) => {
		const entries = page.locator('.toc-block-item');
		// A first-release family is one short entry that leaves nothing unmounted, so pick the
		// family with the longest outline at runtime: the precondition needs a tall document.
		const chips = page.locator('.changelog-family');
		const chipCount = await chips.count();
		let tallest = 0;
		let tallestEntries = 0;
		for (let i = 0; i < chipCount; i++) {
			await clickInPlace(chips.nth(i));
			await clickInPlace(page.locator('.details-toggle'));
			await expect(entries.first()).toBeVisible();
			const n = await entries.count();
			if (n > tallestEntries) {
				tallestEntries = n;
				tallest = i;
			}
		}
		await clickInPlace(chips.nth(tallest));
		await clickInPlace(page.locator('.details-toggle'));
		await expect(entries.first()).toBeVisible();
		await expect.poll(() => entries.count()).toBeGreaterThan(1);

		// The oldest section, read at runtime so a new release entry cannot stale the spec.
		const oldest = entries.last();
		const label = (await oldest.textContent())?.trim() ?? '';
		// A blank label would make the windowed-out precondition below vacuously true.
		expect(label).not.toBe('');
		const heading = page.locator('[data-block-kind="heading"]', { hasText: label });
		// Precondition: the tail is unmounted, so the click has to mount it, not just scroll.
		await expect(heading).toHaveCount(0);

		await clickInPlace(oldest);
		await expect(heading).toBeInViewport();
	});

	test("the family file's own index pointer is not mounted", async ({ page }) => {
		// The file opens with a link to `../changelog.md`, right on GitHub and a 404 beside this
		// page, so the route drops that one line and nothing after it.
		await expect(page.locator('a[href$="changelog.md"]')).toHaveCount(0);
		const opener = page.locator('[data-block-kind="paragraph"]').first();
		await expect(opener).not.toContainText('Newest first');

		// The oldest family follows the pointer with a `git log` hint, which must survive the drop.
		await clickInPlace(page.locator('.changelog-family').last());
		await expect(opener).toContainText('Compact summary');
		await expect(page.locator('a[href$="changelog.md"]')).toHaveCount(0);
	});

	test('expanding the outline in reading mode moves no bytes', async ({ page }) => {
		const before = await outlineRaw(page);
		expect(before.startsWith('<details>\n')).toBe(true);

		await clickInPlace(page.locator('.details-toggle'));
		// The body really mounted, which `aria-expanded` alone could fake.
		await expect(page.locator('.toc-block-item').first()).toBeVisible();

		expect(await outlineRaw(page)).toBe(before);
	});

	test('the family picker swaps the document to another release family', async ({ page }) => {
		const heading = page.locator('[data-block-kind="heading"]').first();
		const active = page.locator('.changelog-family[aria-pressed="true"]');
		const current = (await active.getAttribute('data-family')) ?? '';
		await expect(heading).toContainText(`Changelog ${current}`);

		// The oldest family, read at runtime so a new family file cannot stale the spec.
		const oldest = page.locator('.changelog-family').last();
		const target = (await oldest.getAttribute('data-family')) ?? '';
		expect(target).not.toBe(current);

		await clickInPlace(oldest);
		await expect(heading).toContainText(`Changelog ${target}`);
		// The outline serves the document on screen, not the one it was first built for.
		await clickInPlace(page.locator('.details-toggle'));
		await expect(page.locator('.toc-block-item').first()).toContainText(target);
	});

	test('the Find chord opens the search bar over the reading-mode document', async ({ page }) => {
		// Reading mode puts no caret in a block, so the chord reaches the one mounted editor
		// because that editor takes body-level chords, not through a focused element.
		await page.keyboard.press('ControlOrMeta+f');
		await expect(findInput(page)).toBeFocused();
	});

	test("opens in the showcase's light theme, the page around the editor included", async ({
		page
	}) => {
		await expectTheme(page, '.changelog', 'light');
	});

	test('the header theme toggle flips the editor and the page, and back', async ({ page }) => {
		const toggle = page.getByTestId('theme-toggle');
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');

		await clickInPlace(toggle);
		await expectTheme(page, '.changelog', 'dark');
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');

		await clickInPlace(toggle);
		await expectTheme(page, '.changelog', 'light');
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	});

	test('a dark theme chosen here carries to the showcase', async ({ page }) => {
		await clickInPlace(page.getByTestId('theme-toggle'));
		await expectTheme(page, '.changelog', 'dark');

		await clickInPlace(page.getByRole('link', { name: 'showcase' }));
		await expect(page).toHaveURL(/\/$/);
		await expectTheme(page, '.showcase', 'dark');
	});

	test('at desktop width the families sit in one track and the bar fits', async ({ page }) => {
		await expect(page.locator('.changelog-families')).toBeVisible();
		await expect(page.locator('.changelog-family-picker')).toBeHidden();
		const bar = page.locator('.changelog-header .showcase-bar');
		expect(await bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
	});

	test('the header link navigates back to the showcase', async ({ page }) => {
		// `resolve()` under a configured base path: a wrong href lands on a 404 with the URL still
		// looking plausible, so what the destination page itself shows is the real assertion.
		await clickInPlace(page.locator('.changelog-link'));
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByTestId('showcase-settings')).toBeVisible();
	});
});

test.describe('/changelog theme, chosen on the showcase', () => {
	test.beforeEach(async ({ page }) => {
		await gotoReady(page, '/');
	});

	// Light is the default, so its row goes through dark and back, as a visitor trying both would.
	for (const [theme, flips] of [
		['dark', 1],
		['light', 2]
	] as const) {
		test(`the ${theme} theme chosen on the showcase carries to the changelog`, async ({ page }) => {
			for (let i = 0; i < flips; i++) await clickShowcaseSetting(page, 'theme-toggle');
			await expectTheme(page, '.showcase', theme);

			await clickInPlace(page.getByRole('link', { name: 'changelog' }));
			await expect(page).toHaveURL(/\/changelog\/?$/);
			await expectTheme(page, '.changelog', theme);
		});
	}
});

// No beforeEach: each row is two full page loads, which is what a stored choice has to survive.
test.describe('the stored theme on a fresh load', () => {
	test('a dark theme chosen on the showcase holds on a fresh load of the changelog', async ({
		page
	}) => {
		await gotoReady(page, '/');
		await clickShowcaseSetting(page, 'theme-toggle');
		await expectTheme(page, '.showcase', 'dark');

		await gotoReady(page, '/changelog');
		await expectTheme(page, '.changelog', 'dark');
	});

	// Both routes are prerendered light, so a stored dark has to land before the app's scripts do.
	for (const [route, wrapper] of [
		['/', '.showcase'],
		['/changelog', '.changelog']
	] as const) {
		test(`a returning dark visitor sees ${route} dark before it hydrates`, async ({ page }) => {
			await gotoReady(page, '/');
			await clickShowcaseSetting(page, 'theme-toggle');
			await expectTheme(page, '.showcase', 'dark');

			await gotoUnhydrated(page, route);
			await expect(page.locator(`${wrapper} .editor`)).toHaveAttribute('data-editor-theme', 'dark');
			await expect.poll(() => pageTheme(page, wrapper)).toBe('dark');
		});
	}
});

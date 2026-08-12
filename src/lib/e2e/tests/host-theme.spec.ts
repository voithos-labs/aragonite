import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { waitForEditorHydrated } from '../page-probes';

// `/test/host-theme` feeds the editor from a page wrapper with no `.aragonite-editor-theme`
// anywhere, so it is the route-level G4.6d check: the host's own colour tokens must reach
// painted editor text unbridged. Only real layout can answer it — computed colour and the
// `:where()` shadowing rule are what jsdom does not have.
// Requirements: e2e/requirements/host-theme.md.

const editorRoot = (page: Page) => page.locator('.editor');

function accentToken(page: Page, selector = '.editor'): Promise<string> {
	return page
		.locator(selector)
		.evaluate((el: Element) => getComputedStyle(el).getPropertyValue('--color-accent').trim());
}

function colorOf(page: Page, selector: string): Promise<string> {
	return page
		.locator(selector)
		.first()
		.evaluate((el: Element) => getComputedStyle(el).color);
}

test.describe('/test/host-theme', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/host-theme');
		await waitForEditorHydrated(page);
	});

	test('the route carries no opt-in theme class anywhere', async ({ page }) => {
		await expect(page.locator('.aragonite-editor-theme')).toHaveCount(0);
	});

	test('picking an accent moves the token on the editor root to the host wrapper value', async ({
		page
	}) => {
		const before = await accentToken(page);
		// A default declared at editor scope would beat the inherited host value and pin the
		// editor at the theme's own green whatever the picker says — hence the comparison
		// against the wrapper rather than against a hex.
		await page.getByLabel('Accent').selectOption('copper');

		const after = await accentToken(page);
		expect(after).not.toBe(before);
		expect(after).toBe(await accentToken(page, '.host-page'));

		await page.getByLabel('Accent').selectOption('default');
		expect(await accentToken(page)).toBe(before);
	});

	test('picking an accent repaints the editor surfaces that read it', async ({ page }) => {
		const body = await colorOf(page, '.paragraph-block');
		const before = {
			link: await colorOf(page, 'a.md-link-content'),
			footnote: await colorOf(page, '.footnote-ref')
		};
		expect(before.link).not.toBe(body);
		expect(before.footnote).toBe(before.link);

		await page.getByLabel('Accent').selectOption('copper');

		const after = {
			link: await colorOf(page, 'a.md-link-content'),
			footnote: await colorOf(page, '.footnote-ref')
		};
		expect(after.link).not.toBe(before.link);
		expect(after.footnote).toBe(after.link);
		expect(await colorOf(page, '.paragraph-block')).toBe(body);
	});

	test('accent and theme are independent axes', async ({ page }) => {
		await page.getByLabel('Accent').selectOption('teal');
		const dark = await accentToken(page);

		// Each preset carries a per-mode hex, so the same pick resolves to a different value
		// once the host flips palettes: the pick survives, the value follows the mode.
		await page.getByLabel('Theme').selectOption('paper-light');
		await expect(editorRoot(page)).toHaveAttribute('data-editor-theme', 'light');
		expect(await accentToken(page)).not.toBe(dark);
	});
});

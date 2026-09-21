import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { waitForEditorHydrated } from '../page-probes';

// `/test/host-theme` feeds the editor from a page wrapper with no `.aragonite-editor-theme`
// anywhere, which is the route-level check for G4.6d: the app's own colour tokens must reach
// the editor's text on their own. Only a real browser can answer it, since computed colours and
// how `:where()` loses to other rules are what jsdom does not have.
// Requirements: e2e/requirements/host-theme.md.

const editorRoot = (page: Page) => page.locator('.editor');

function tokenOn(page: Page, selector: string, token: string): Promise<string> {
	return page
		.locator(selector)
		.evaluate((el: Element, name) => getComputedStyle(el).getPropertyValue(name).trim(), token);
}

const accentToken = (page: Page, selector = '.editor') => tokenOn(page, selector, '--color-accent');

function colorOf(page: Page, selector: string): Promise<string> {
	return page
		.locator(selector)
		.first()
		.evaluate((el: Element) => getComputedStyle(el).color);
}

/**
 * Escalates Mod+A from block text to the whole document, so whole blocks fall inside the
 * selection and paint a full-bleed `.selection-overlay-middle` rather than an endpoint sliver
 * whose rect can be empty at a boundary.
 */
async function selectWholeDocument(page: Page): Promise<void> {
	await page.locator('.editor [contenteditable="true"]').first().click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('ControlOrMeta+a');
	await expect(page.locator('.selection-overlay-middle').first()).toBeVisible();
}

/** The tint the wrapper's own selection colour produces, measured rather than written out. */
function washFromWrapper(page: Page, percent: number): Promise<string> {
	return page.evaluate((pct) => {
		const wrapper = document.querySelector('.host-page') as HTMLElement;
		const base = getComputedStyle(wrapper).getPropertyValue('--color-selection').trim();
		const probe = document.createElement('div');
		wrapper.appendChild(probe);
		probe.style.backgroundColor = `color-mix(in srgb, ${base} ${pct}%, transparent)`;
		const used = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return used;
	}, percent);
}

const overlayBackground = (page: Page) =>
	page
		.locator('.selection-overlay-middle')
		.first()
		.evaluate((el: Element) => getComputedStyle(el).backgroundColor);

test.describe('/test/host-theme', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/host-theme');
		await waitForEditorHydrated(page);
	});

	test('the route carries no opt-in theme class anywhere', async ({ page }) => {
		await expect(page.locator('.aragonite-editor-theme')).toHaveCount(0);
	});

	test('the wrapper supplies the UI font the page chrome reads', async ({ page }) => {
		// A wrapper value equal to the app stylesheet's would prove nothing: the editor would
		// show the same font with the wrapper declaring none.
		const wrapper = await tokenOn(page, '.host-page', '--font-ui');
		expect(wrapper).not.toBe(await tokenOn(page, 'html', '--font-ui'));
		expect(
			await page.locator('.hero-title').evaluate((el: Element) => getComputedStyle(el).fontFamily)
		).toBe(wrapper);
	});

	test('picking an accent moves the token on the editor root to the host wrapper value', async ({
		page
	}) => {
		const before = await accentToken(page);
		// A default declared on the editor itself would beat the value inherited from the app
		// and hold the editor at the theme's own green whatever the picker says, which is why
		// this compares against the wrapper rather than against a fixed colour.
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

	test('a host-declared selection base reaches the painted selection overlay', async ({ page }) => {
		await selectWholeDocument(page);
		const slate = await overlayBackground(page);
		expect(slate).toBe(await washFromWrapper(page, 30));

		// Proves something without naming a colour: an overlay held at the editor's own blue
		// would show that same blue under an app whose selection colour is copper.
		await page.getByLabel('Theme').selectOption('warm-dark');
		await selectWholeDocument(page);
		const warm = await overlayBackground(page);
		expect(warm).not.toBe(slate);
		expect(warm).toBe(await washFromWrapper(page, 30));
	});

	test('accent and theme are independent axes', async ({ page }) => {
		await page.getByLabel('Accent').selectOption('teal');
		const dark = await accentToken(page);

		// Each preset holds a colour per mode, so the same choice gives a different value once
		// the app switches palettes: the choice survives, the colour follows the mode.
		await page.getByLabel('Theme').selectOption('paper-light');
		await expect(editorRoot(page)).toHaveAttribute('data-editor-theme', 'light');
		expect(await accentToken(page)).not.toBe(dark);
	});
});

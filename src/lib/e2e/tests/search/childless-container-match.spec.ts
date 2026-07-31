import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { primaryModifier } from '../../platform';
import { PluginsPage } from '../plugins/helpers';

/**
 * Search inside a childless opaque container
 * (requirements/search/childless-container-match.md). A mermaid block's text
 * lives in its own raw — no leaf children — so the scanner matches the raw like
 * a leaf and `DecorationOverlay` paints those marks through the container shim's
 * `measurePartialRects`. Replace skips those matches (metadata-derived raw;
 * issue #41), so `replacedCount` counts only real rewrites.
 */

const findInput = (page: Page) => page.getByRole('textbox', { name: 'Find' });
const replaceInput = (page: Page) => page.getByRole('textbox', { name: 'Replace' });
const count = (page: Page) => page.locator('.search-count');
const mermaidHost = (page: Page) => page.locator("[data-block-kind='mermaid']");

const MERMAID_FENCE = '```mermaid\ngraph TD\n\tZZNEEDLE --> B\n```\n';

const mermaidInViewport = (page: Page) =>
	page.evaluate(() => {
		const ed = document.querySelector('.editor')!.getBoundingClientRect();
		const host = document.querySelector("[data-block-kind='mermaid']")?.getBoundingClientRect();
		return !!host && host.bottom > ed.top && host.top < ed.bottom;
	});

test.describe('search — childless opaque container', () => {
	let editor: PluginsPage;
	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mermaid');
	});

	test('a match inside a mermaid block is found, painted, and revealed by navigation', async ({
		page
	}) => {
		// Filler pushes the mermaid below the fold, so the reveal is observable.
		const filler = Array.from({ length: 40 }, (_, i) => `filler paragraph ${i}`).join('\n\n');
		await editor.loadContent(`${filler}\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);
		expect(await mermaidInViewport(page), 'mermaid must start off-screen').toBe(false);

		await editor.clickBlock(0);
		await page.keyboard.press(`${primaryModifier}+f`);
		await findInput(page).waitFor({ state: 'visible' });
		await page.keyboard.type('ZZNEEDLE');

		// The query exists only inside the mermaid source; finding it at all is the
		// scan half of the fix, painting it inside the host is the overlay half.
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		const overlay = mermaidHost(page).locator('.match-overlay');
		await expect(overlay).toHaveCount(1);
		const box = await overlay.boundingBox();
		expect(box!.width).toBeGreaterThan(0);

		await page.keyboard.press('Enter');
		await expect.poll(() => mermaidInViewport(page)).toBe(true);
		await expect(mermaidHost(page).locator('.match-overlay-active')).toHaveCount(1);
	});

	test('Replace All rewrites the prose match, skips the mermaid match, and reports 1 replaced', async ({
		page
	}) => {
		await editor.loadContent(`prose ZZNEEDLE here\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);

		await editor.clickBlock(0);
		await page.keyboard.press(`${primaryModifier}+h`);
		await replaceInput(page).waitFor({ state: 'visible' });
		await findInput(page).click();
		await page.keyboard.type('ZZNEEDLE');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
		await replaceInput(page).fill('FOUND');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('prose FOUND here');

		const source = await editor.bridge.getSource();
		expect(source).toContain('ZZNEEDLE --> B'); // mermaid source untouched
		expect(source.match(/FOUND/g)?.length).toBe(1);
		await expect(mermaidHost(page)).toHaveCount(1); // fence kept its kind
		// The mermaid match survives the rescan (1 / 1); the replaced count comes
		// from the probe — the bar shows the count while matches remain.
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		expect(await page.evaluate(() => (window as any).__test.getSearchReplacedCount())).toBe(1);
	});
});

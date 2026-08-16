import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { primaryModifier } from '../../platform';
import { PluginsPage } from '../plugins/helpers';

/**
 * Search inside a childless opaque container
 * (requirements/search/childless-container-match.md). Its text lives in its own raw with no
 * leaf children, so the scanner matches that raw like a leaf and the container shim's
 * `measurePartialRects` paints it. Replace rewrites those matches through the reparse path,
 * declining only the substitution that would come back as a different kind (#41).
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

	/** Type `query` into a freshly opened replace bar and wait for the match tally to settle. */
	async function openReplaceOn(page: Page, query: string, tally: RegExp): Promise<void> {
		await editor.clickBlock(0);
		await page.keyboard.press(`${primaryModifier}+h`);
		await replaceInput(page).waitFor({ state: 'visible' });
		await findInput(page).click();
		await page.keyboard.type(query);
		await expect(count(page)).toHaveText(tally);
	}

	test('Replace All rewrites the mermaid match too, and the fence keeps its kind', async ({
		page
	}) => {
		await editor.loadContent(`prose ZZNEEDLE here\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);

		await openReplaceOn(page, 'ZZNEEDLE', /1\s*\/\s*2/);
		await replaceInput(page).fill('FOUND');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('prose FOUND here');

		const source = await editor.bridge.getSource();
		expect(source).toContain('FOUND --> B'); // the container's own raw was rewritten
		expect(source).not.toContain('ZZNEEDLE');
		await expect(mermaidHost(page)).toHaveCount(1); // the reparse came back the same kind
		await expect(count(page)).toHaveText('2 replaced');
		expect(await page.evaluate(() => (window as any).__test.getSearchReplacedCount())).toBe(2);
	});

	test('a replacement that would re-kind the fence is declined, and the prose one still lands', async ({
		page
	}) => {
		// `mermaid` matches the prose AND the fence's info string; rewriting the info string
		// would reparse the block as a plain fencedCode, which is the one decline (#41).
		await editor.loadContent(`prose mermaid here\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);

		await openReplaceOn(page, 'mermaid', /1\s*\/\s*2/);
		await replaceInput(page).fill('js');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('prose js here');

		expect(await editor.bridge.getSource()).toContain('```mermaid');
		await expect(mermaidHost(page)).toHaveCount(1);
		// The declined match survives the rescan (1 / 1), so the bar shows the tally rather
		// than the replaced count; the probe carries the count.
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		expect(await page.evaluate(() => (window as any).__test.getSearchReplacedCount())).toBe(1);
	});
});

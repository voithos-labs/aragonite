import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { count, findInput, openFind, openReplace, replaceInput, typeQuery } from './helpers';

/**
 * Search inside a childless opaque container
 * (`requirements/search/childless-container-match.md`). Its text lives in its own raw with no
 * leaf children, so the scanner matches that raw like a leaf and the container's
 * `measurePartialRects` paints it. Replace rewrites those matches through the reparse path,
 * declining only the substitution that would come back as a different kind (#41).
 */

const mermaidHost = (page: Page) => page.locator("[data-block-kind='mermaid']");

const MERMAID_FENCE = '```mermaid\ngraph TD\n\tZZNEEDLE --> B\n```\n';

const mermaidInViewport = (page: Page) =>
	page.evaluate(() => {
		const ed = document.querySelector('.editor')!.getBoundingClientRect();
		const host = document.querySelector("[data-block-kind='mermaid']")?.getBoundingClientRect();
		return !!host && host.bottom > ed.top && host.top < ed.bottom;
	});

test.describe('search: childless opaque container', () => {
	let editor: PluginsPage;
	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mermaid');
	});

	test('a match inside a mermaid block is found, painted, and revealed by navigation', async ({
		page
	}) => {
		// Filler pushes the mermaid below the fold, so the scroll into view can be observed.
		const filler = Array.from({ length: 40 }, (_, i) => `filler paragraph ${i}`).join('\n\n');
		await editor.loadContent(`${filler}\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);
		expect(await mermaidInViewport(page), 'mermaid must start off-screen').toBe(false);

		await openFind(editor);
		await typeQuery(editor, 'ZZNEEDLE');

		// The query exists only inside the mermaid source: finding it at all is the scan half,
		// painting it inside the host is the overlay half.
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
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, query);
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
		// `mermaid` matches the prose and the fence's info string; rewriting the info string
		// would reparse the block as a plain fenced code block, the one case replace declines
		// (#41).
		await editor.loadContent(`prose mermaid here\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);

		await openReplaceOn(page, 'mermaid', /1\s*\/\s*2/);
		await replaceInput(page).fill('js');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('prose js here');

		expect(await editor.bridge.getSource()).toContain('```mermaid');
		await expect(mermaidHost(page)).toHaveCount(1);
		// The declined match survives the rescan (1 / 1), so the bar shows the tally rather
		// than the replaced count; the test hook below carries the count.
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		expect(await page.evaluate(() => (window as any).__test.getSearchReplacedCount())).toBe(1);
	});

	test('a replacement that eats the closing fence gets the fence back, and the block below stands', async ({
		page
	}) => {
		await editor.loadContent(`${MERMAID_FENCE}\nTail\n`);
		await expect(mermaidHost(page)).toHaveCount(1);

		await openReplace(editor);
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click();
		await typeQuery(editor, 'B\\n```');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		await replaceInput(page).fill('C');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('ZZNEEDLE --> C');

		expect(await editor.bridge.getSource()).toBe(
			'```mermaid\ngraph TD\n\tZZNEEDLE --> C\n```\n\nTail\n'
		);
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});
});

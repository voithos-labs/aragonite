import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { clickInPlace } from '../../click-in-place';

/**
 * A table of contents that reads the document through `depends` (requirements/plugins/
 * outline-depends.md), from `routes/test/plugins/outline`: an `[[outline]]` box listing every
 * heading, its rows a way back to each.
 */

interface OutlineLog {
	draws: number;
	updates: number;
	drawn: string[];
}

const outline = (page: Page) => page.locator('nav[data-outline] [data-row]');
const rows = (page: Page) => outline(page).allTextContents();
const outlineLog = (page: Page): Promise<OutlineLog> =>
	page.evaluate(() => ({ ...(window as any).__outline }));
const keysAsked = (page: Page): Promise<number> =>
	page.evaluate(() => (window as any).__test.perf.snapshot().keysAsked);
const countKeys = (page: Page) =>
	page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
const caretPath = (page: Page): Promise<number[] | null> =>
	page.evaluate(() => (window as any).__test.getSelection()?.focus.path ?? null);
const kindAt = (page: Page, index: number): Promise<string> =>
	page.evaluate((i) => (window as any).__test.getDocument().children[i].kind, index);

const OUTLINE = ['Alpha', 'Beta', 'Omega'];
const ALPHA = 1;
const PARA_ONE = 2;
const BETA = 3;
const PARA_TWO = 4;
// `## Beta` once an Enter in the paragraph above it has split that paragraph in two.
const BETA_AFTER_ENTER = 4;

test.describe('an outline drawn from depends', () => {
	test('lists every heading as it first shows, drawn with the answers', async ({ page }) => {
		// The rows the outline holds the moment it enters the page, before any frame can paint.
		await page.addInitScript(() => {
			const seen: number[] = [];
			(window as any).__outlineFirst = seen;
			new MutationObserver(() => {
				const nav = document.querySelector('nav[data-outline]');
				if (nav && seen.length === 0) seen.push(nav.children.length);
			}).observe(document, { childList: true, subtree: true });
		});
		await new PluginsPage(page).gotoPlugins('outline');
		await expect.poll(() => rows(page)).toEqual(OUTLINE);
		expect(await page.evaluate(() => (window as any).__outlineFirst)).toEqual([OUTLINE.length]);
		const log = await outlineLog(page);
		expect([log.drawn, log.draws, log.updates]).toEqual([OUTLINE, 1, 0]);
	});

	test('follows a key typed in a heading', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins('outline');
		await ep.focusBlockEnd(ALPHA);
		await page.keyboard.type('X');
		await expect.poll(() => rows(page)).toEqual(['AlphaX', 'Beta', 'Omega']);
	});

	test('asks one block and updates nothing on a key in a paragraph', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins('outline');
		await expect.poll(() => rows(page)).toEqual(OUTLINE);
		const { updates } = await outlineLog(page);
		await ep.focusBlockEnd(PARA_TWO);
		await countKeys(page);
		await page.keyboard.type('x');
		await ep.waitForRenderFlush();
		expect([await keysAsked(page), (await outlineLog(page)).updates]).toEqual([1, updates]);
	});

	test('takes the caret to a heading from its row after an Enter above it', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins('outline');
		await ep.focusBlock(PARA_ONE, 4);
		await page.keyboard.press('Enter');
		await ep.waitForRenderFlush();
		expect(await kindAt(page, BETA_AFTER_ENTER)).toBe('heading');
		await clickInPlace(outline(page).filter({ hasText: 'Beta' }));
		await expect.poll(() => caretPath(page)).toEqual([BETA_AFTER_ENTER]);
	});

	test('takes the caret to a heading from its row after an Enter above it is undone', async ({
		page
	}) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins('outline');
		await ep.focusBlock(PARA_ONE, 4);
		await page.keyboard.press('Enter');
		await ep.waitForRenderFlush();
		await page.keyboard.press('ControlOrMeta+z');
		await ep.waitForRenderFlush();
		expect(await kindAt(page, BETA)).toBe('heading');
		await clickInPlace(outline(page).filter({ hasText: 'Beta' }));
		await expect.poll(() => caretPath(page)).toEqual([BETA]);
	});

	test('scrolled out of the window and back, shows the same outline and asks no block', async ({
		page
	}) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins('outline');
		await expect.poll(() => rows(page)).toEqual(OUTLINE);
		const { draws } = await outlineLog(page);
		await ep.scrollEditorTo(1e9);
		await expect(page.locator('nav[data-outline]')).toHaveCount(0);
		await countKeys(page);
		await ep.scrollEditorTo(0);
		await expect.poll(() => rows(page)).toEqual(OUTLINE);
		expect([(await outlineLog(page)).draws, await keysAsked(page)]).toEqual([draws + 1, 0]);
	});
});

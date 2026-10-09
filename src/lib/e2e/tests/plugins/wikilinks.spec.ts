import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * `[[note]]` links as inline widgets in a host whose links follow on a plain click, the limestone
 * integration reproduced in the harness (`routes/test/plugins/wikilinks`): `revealSource` for
 * editing, `claimsActivationClick` for navigation, and the editor's `linkClick: 'plain'`. Seed
 * `wikilinks`: a link mid-prose (block 0), a typing target (block 1), a Markdown link (block 2).
 * Requirements: e2e/requirements/plugins/wikilinks.md.
 */

const link = (editor: PluginsPage) => editor.page.locator('.wikilink[data-target="Meeting notes"]');

const markdownLink = (editor: PluginsPage) =>
	editor.page.locator('a.md-link-content', { hasText: 'the docs' });

/** Records the URLs the editor's default link activation opens, instead of opening them. */
async function recordOpens(page: Page): Promise<() => Promise<string[]>> {
	await page.evaluate(() => {
		const probe = window as Window & { __opened?: string[] };
		probe.__opened = [];
		window.open = ((url: string) => {
			probe.__opened!.push(url);
			return null;
		}) as typeof window.open;
	});
	return () => page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? []);
}

const activations = (page: Page) =>
	page.evaluate(
		() => (window as never as { __linkActivations?: string[] }).__linkActivations ?? []
	);

async function clickLink(editor: PluginsPage, modifier?: 'Control'): Promise<void> {
	const box = await link(editor).boundingBox();
	if (!box) throw new Error('no link box');
	if (modifier) await editor.page.keyboard.down(modifier);
	await editor.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	if (modifier) await editor.page.keyboard.up(modifier);
	await editor.waitForRenderFlush();
}

test.describe('wikilinks that follow on a plain click', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('wikilinks');
		await editor.setPresentationMode('live');
		await editor.waitForRenderFlush();
	});

	test('a plain click follows the link and leaves it standing', async ({ page }) => {
		const before = await editor.bridge.getSource();

		await clickLink(editor);

		expect(await activations(page)).toEqual(['Meeting notes']);
		await expect(link(editor)).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a Ctrl-click follows it too', async ({ page }) => {
		await clickLink(editor, 'Control');

		expect(await activations(page)).toEqual(['Meeting notes']);
		await expect(link(editor)).toHaveCount(1);
	});

	test('the caret arrowing in shows the source for editing, and leaving restores it', async ({
		page
	}) => {
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
		await editor.waitForRenderFlush();

		await expect(link(editor)).toHaveCount(0);
		expect(await activations(page)).toEqual([]);

		await editor.clickBlock(1);
		await editor.waitForRenderFlush();
		await expect(link(editor)).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('See [[Meeting notes]] for today');
	});

	test('a plain click on a Markdown link follows it too, and opens no link card', async ({
		page
	}) => {
		const opened = await recordOpens(page);

		await markdownLink(editor).click();
		await editor.waitForRenderFlush();

		expect(await opened()).toEqual(['https://example.com/']);
		await expect(page.locator('[data-link-card]')).toHaveCount(0);
	});

	test('a Markdown link shows the pointer a plain click follows, and source mode the text cursor', async () => {
		await expect(markdownLink(editor)).toHaveCSS('cursor', 'pointer');

		await editor.setPresentationMode('source');
		await editor.waitForRenderFlush();

		await expect(markdownLink(editor)).toHaveCSS('cursor', 'text');
	});

	test('in source mode, where links show their syntax, a plain click edits instead', async ({
		page
	}) => {
		await editor.setPresentationMode('source');
		await editor.waitForRenderFlush();
		const opened = await recordOpens(page);

		await markdownLink(editor).click();
		await clickLink(editor);

		expect(await opened()).toEqual([]);
		expect(await activations(page)).toEqual([]);
		await expect(link(editor)).toHaveCount(0);
	});

	test('a drag that starts on the link selects and follows nothing', async ({ page }) => {
		const box = await link(editor).boundingBox();
		if (!box) throw new Error('no link box');
		const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let step = 1; step <= 6; step++) await page.mouse.move(from.x + (200 * step) / 6, from.y);
		await page.mouse.up();
		await editor.waitForRenderFlush();

		expect(await activations(page)).toEqual([]);
		await expect(link(editor)).toHaveCount(1);
		expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('today');
	});
});

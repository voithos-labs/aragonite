import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage, capturedErrors } from './helpers';
import { multiClickElement } from '../../multi-click';
import { TEXT_FIELD, URL_FIELD } from '../presentation/link-card-helpers';

/**
 * `[[note]]` links as inline widgets in a host whose links follow on a plain click, the limestone
 * integration reproduced in the harness (`routes/test/plugins/wikilinks`, `linkClick: 'plain'`),
 * and the Markdown links and autolinks beside them. The seed's blocks and the scenarios are in
 * e2e/requirements/plugins/wikilinks.md.
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

async function clickLink(editor: PluginsPage, modifier?: 'ControlOrMeta'): Promise<void> {
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
		await clickLink(editor, 'ControlOrMeta');

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

	test('a double-click follows once, on the link and on a Markdown link', async ({ page }) => {
		const opened = await recordOpens(page);
		await multiClickElement(link(editor), 2);
		await multiClickElement(markdownLink(editor), 2);
		await editor.waitForRenderFlush();

		expect(await activations(page)).toEqual(['Meeting notes']);
		expect(await opened()).toEqual(['https://example.com/']);
	});

	test('a drag inside a Markdown link selects its text and opens nothing', async ({ page }) => {
		const opened = await recordOpens(page);
		const box = await markdownLink(editor).boundingBox();
		if (!box) throw new Error('no Markdown link box');
		const y = box.y + box.height / 2;
		await page.mouse.move(box.x + 2, y);
		await page.mouse.down();
		for (let step = 1; step <= 6; step++) {
			await page.mouse.move(box.x + 2 + ((box.width - 4) * step) / 6, y);
		}
		await page.mouse.up();
		await editor.waitForRenderFlush();

		expect(await opened()).toEqual([]);
		expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('docs');
	});

	test('switched back to Ctrl-click after mount, a plain click edits again', async ({ page }) => {
		const opened = await recordOpens(page);

		await page.getByTestId('link-click-toggle').click();
		await clickLink(editor);
		await markdownLink(editor).click();
		await editor.waitForRenderFlush();

		expect(await activations(page)).toEqual([]);
		expect(await opened()).toEqual([]);
	});

	test('Edit link in the right-click menu shows the link source, following nothing', async ({
		page
	}) => {
		const box = await link(editor).boundingBox();
		if (!box) throw new Error('no link box');

		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
		await page.getByRole('menuitem', { name: 'Edit link' }).click();
		await editor.waitForRenderFlush();

		await expect(link(editor)).toHaveCount(0);
		expect(await activations(page)).toEqual([]);
	});

	test('Edit link on a Markdown link opens its card, field focused, following nothing', async ({
		page
	}) => {
		const opened = await recordOpens(page);

		await markdownLink(editor).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Edit link' }).click();

		await expect(page.locator('[data-link-card]')).toBeVisible();
		await expect(page.locator('[data-link-card] input[aria-label="Link URL"]')).toBeFocused();
		expect(await opened()).toEqual([]);
	});

	test('Edit link on a link in a table cell shows its source, following nothing', async ({
		page
	}) => {
		const cellLink = page.locator('.wikilink[data-target="Cell note"]');
		const box = await cellLink.boundingBox();
		if (!box) throw new Error('no cell link box');

		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
		await page.getByRole('menuitem', { name: 'Edit link' }).click();
		await editor.waitForRenderFlush();

		await expect(cellLink).toHaveCount(0);
		expect(await activations(page)).toEqual([]);
	});

	test('Mod+K with the caret beside the link shows its source', async ({ page }) => {
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ControlOrMeta+k');
		await editor.waitForRenderFlush();

		await expect(link(editor)).toHaveCount(0);
		expect(await activations(page)).toEqual([]);
	});

	test('a drag that starts on a link in a table cell shows no source and follows nothing', async ({
		page
	}) => {
		const cellLink = page.locator('.wikilink[data-target="Cell note"]');
		const box = await cellLink.boundingBox();
		if (!box) throw new Error('no cell link box');
		const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let step = 1; step <= 6; step++) {
			await page.mouse.move(from.x + ((box.width / 2 + 20) * step) / 6, from.y);
		}
		await page.mouse.up();
		await editor.waitForRenderFlush();

		await expect(cellLink).toHaveCount(1);
		expect(await activations(page)).toEqual([]);
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

// An autolink's text is its URL, so its card holds the URL in both fields. A new URL there rewrites
// the autolink in its own form; the keys inside the URL still take one letter at a time.
const AUTOLINKS = [
	{
		name: 'a bare URL',
		block: 4,
		url: 'https://example.org/bare',
		end: 24,
		edited: '\nhttps://example.org/new\n',
		backspaced: '\nhttps://example.org/bar\n'
	},
	{
		name: 'an angle autolink',
		block: 5,
		url: 'https://example.org/angle',
		end: 30,
		edited: 'See <https://example.org/new> here',
		backspaced: 'See <https://example.org/angl> here'
	}
] as const;

test.describe('autolinks a click follows open the link card', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('wikilinks');
		await editor.setPresentationMode('live');
		await editor.waitForRenderFlush();
	});

	async function editLinkFromMenu(page: Page, on: string): Promise<void> {
		const box = await page.locator(on).boundingBox();
		if (!box) throw new Error(`no box for ${on}`);
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
		await page.getByRole('menuitem', { name: 'Edit link' }).click();
	}

	async function expectCardHolding(page: Page, url: string): Promise<void> {
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await expect(page.locator(URL_FIELD)).toHaveValue(url);
		await expect(page.locator(TEXT_FIELD)).toHaveValue(url);
	}

	for (const host of ['plain', 'modifier'] as const) {
		for (const autolink of AUTOLINKS) {
			test(`Edit link on ${autolink.name} opens its card and follows nothing, ${host} click host`, async ({
				page
			}) => {
				const opened = await recordOpens(page);
				if (host === 'modifier') await page.getByTestId('link-click-toggle').click();

				await editLinkFromMenu(page, `[data-block-path="[${autolink.block}]"] a.md-autolink`);

				await expectCardHolding(page, autolink.url);
				expect(await opened()).toEqual([]);
			});
		}
	}

	for (const autolink of AUTOLINKS) {
		test(`a new URL in the card of ${autolink.name} rewrites it in its own form`, async ({
			page
		}) => {
			await editLinkFromMenu(page, `[data-block-path="[${autolink.block}]"] a.md-autolink`);
			await expectCardHolding(page, autolink.url);
			await page.keyboard.press('ControlOrMeta+a');
			await page.keyboard.type('https://example.org/new');
			await page.keyboard.press('Enter');

			await editor.bridge.waitForSourceContains(autolink.edited);
		});

		test(`Mod+K inside ${autolink.name} enters its card`, async ({ page }) => {
			await editor.focusBlockAtPath([autolink.block], autolink.end - 2);
			await page.keyboard.press('ControlOrMeta+k');

			await expectCardHolding(page, autolink.url);
		});

		test(`Backspace at the end of ${autolink.name} takes one letter`, async ({ page }) => {
			await editor.focusBlockAtPath([autolink.block], autolink.end - 1);
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('Backspace');

			await editor.bridge.waitForSourceContains(autolink.backspaced);
		});
	}

	test('Delete inside an angle autolink takes one letter', async ({ page }) => {
		await editor.focusBlockAtPath([5], 27);
		await page.keyboard.press('Delete');

		await editor.bridge.waitForSourceContains('See <https://example.org/anle> here');
	});

	for (const host of ['plain', 'modifier'] as const) {
		test(`a bare URL in a table cell follows its click, ${host} click host`, async ({ page }) => {
			const opened = await recordOpens(page);
			if (host === 'modifier') await page.getByTestId('link-click-toggle').click();
			if (host === 'modifier') await page.keyboard.down('ControlOrMeta');
			await page.locator('.table-cell a.md-autolink').click();
			if (host === 'modifier') await page.keyboard.up('ControlOrMeta');

			await expect.poll(opened).toEqual(['https://example.org/cell']);
		});
	}

	test('Edit link on a bare URL in a table cell opens its card', async ({ page }) => {
		await editLinkFromMenu(page, '.table-cell a.md-autolink');

		await expectCardHolding(page, 'https://example.org/cell');
	});
});

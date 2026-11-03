import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage, capturedErrors } from './helpers';
import { multiClickElement } from '../../multi-click';

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

// Edit link leaves a caret at the URL's end, ready to edit: past a bare URL's last letter, inside
// an angle one's hidden `>`. A letter typed there lands in the URL, and Backspace takes one.
const AUTOLINKS = [
	{
		name: 'a bare URL',
		block: 4,
		caret: 24,
		typed: '\nhttps://example.org/bareXY\n',
		backspaced: '\nhttps://example.org/bar\n',
		spaced: '\nhttps://example.org/bare more\n'
	},
	{
		name: 'an angle autolink',
		block: 5,
		caret: 30,
		typed: 'See <https://example.org/angleXY> here',
		backspaced: 'See <https://example.org/angl> here',
		spaced: 'See <https://example.org/angle> more here'
	}
] as const;

test.describe('autolinks a click follows can be edited', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('wikilinks');
		await editor.setPresentationMode('live');
		await editor.waitForRenderFlush();
	});

	async function expectCaretAtUrlEnd(autolink: (typeof AUTOLINKS)[number]): Promise<void> {
		await expect
			.poll(async () => (await editor.bridge.getSelectionPaths())?.focus)
			.toEqual({ path: [autolink.block], offset: autolink.caret });
	}

	async function editLinkFromMenu(page: Page, on: string): Promise<void> {
		const box = await page.locator(on).boundingBox();
		if (!box) throw new Error(`no box for ${on}`);
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
		await page.getByRole('menuitem', { name: 'Edit link' }).click();
	}

	for (const host of ['plain', 'modifier'] as const) {
		for (const autolink of AUTOLINKS) {
			test(`Edit link on ${autolink.name} leaves letters typed in the URL, ${host} click host`, async ({
				page
			}) => {
				const opened = await recordOpens(page);
				if (host === 'modifier') await page.getByTestId('link-click-toggle').click();

				await editLinkFromMenu(page, `[data-block-path="[${autolink.block}]"] a.md-autolink`);
				await expectCaretAtUrlEnd(autolink);
				await page.keyboard.type('XY');

				await editor.bridge.waitForSourceContains(autolink.typed);
				expect(await opened()).toEqual([]);
				await expect(page.locator('[data-link-card]')).toHaveCount(0);
			});

			test(`Mod+K inside ${autolink.name} leaves Backspace taking one letter, ${host} click host`, async ({
				page
			}) => {
				if (host === 'modifier') await page.getByTestId('link-click-toggle').click();
				await editor.focusBlockStart(autolink.block);
				for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');

				await page.keyboard.press('ControlOrMeta+k');
				await expectCaretAtUrlEnd(autolink);
				await page.keyboard.press('Backspace');

				await editor.bridge.waitForSourceContains(autolink.backspaced);
				await expect(page.locator('[data-link-card]')).toHaveCount(0);
			});
		}
	}

	test('Mod+K inside an angle autolink leaves letters typed in the URL', async ({ page }) => {
		await editor.focusBlockStart(5);
		for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ControlOrMeta+k');
		await expectCaretAtUrlEnd(AUTOLINKS[1]);
		await page.keyboard.type('XY');

		await editor.bridge.waitForSourceContains(AUTOLINKS[1].typed);
	});

	test('Delete inside an angle autolink takes one letter', async ({ page }) => {
		await editor.focusBlockStart(5);
		for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ControlOrMeta+k');
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');

		await page.keyboard.press('Delete');

		await editor.bridge.waitForSourceContains('See <https://example.org/anle> here');
	});

	// The edit a user makes to fix a typo at the URL's end: take a letter back, type the right one.
	test('after Edit link, Backspace then a letter keeps the letter in the URL', async ({ page }) => {
		await editLinkFromMenu(page, '[data-block-path="[5]"] a.md-autolink');
		await expectCaretAtUrlEnd(AUTOLINKS[1]);
		await page.keyboard.press('Backspace');
		await page.keyboard.type('X');

		await editor.bridge.waitForSourceContains('See <https://example.org/anglX> here');
	});

	// No URL holds a space, so the word typed after fixing the URL goes after the link.
	for (const autolink of AUTOLINKS) {
		test(`after Edit link on ${autolink.name}, a space and a word land past the URL`, async ({
			page
		}) => {
			await editLinkFromMenu(page, `[data-block-path="[${autolink.block}]"] a.md-autolink`);
			await expectCaretAtUrlEnd(autolink);
			await page.keyboard.type(' more');

			await editor.bridge.waitForSourceContains(autolink.spaced);
			await expect(
				page.locator(`[data-block-path="[${autolink.block}]"] a.md-autolink`)
			).toHaveCount(1);
		});
	}

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

	test('Edit link on a bare URL in a table cell leaves letters typed in the URL', async ({
		page
	}) => {
		await editLinkFromMenu(page, '.table-cell a.md-autolink');
		await page.keyboard.type('XY');

		await editor.bridge.waitForSourceContains('https://example.org/cellXY |');
	});

	test('Edit link on a bare URL in a table cell leaves Backspace taking one letter', async ({
		page
	}) => {
		await editLinkFromMenu(page, '.table-cell a.md-autolink');
		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceContains('https://example.org/cel |');
	});
});

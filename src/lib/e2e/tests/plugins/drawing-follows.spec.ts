import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * A link a block's drawing holds, asking the editor whether a click or a key follows it
 * (requirements/plugins/drawing-follows.md): the `[[see …]]` box of `routes/test/plugins/note-refs`,
 * whose drawing records the name it follows.
 */

const LINK = '.see-link';

const followed = (page: Page): Promise<string[]> =>
	page.evaluate(() => (window as { __followedSees?: string[] }).__followedSees ?? []);

test.describe("a drawing's own link", () => {
	let ep: PluginsPage;

	test.beforeEach(async ({ page }) => {
		ep = new PluginsPage(page);
		await ep.gotoPlugins('note-refs');
		await ep.loadContent('Above.\n\n[[see notes]]\n\nBelow.\n');
		await expect(page.locator(LINK)).toHaveText('See notes');
	});

	for (const mode of ['live', 'source'] as const) {
		test(`a plain click follows nothing in ${mode} mode`, async ({ page }) => {
			await ep.setPresentationMode(mode);
			await page.locator(LINK).click();
			expect(await followed(page)).toEqual([]);
		});

		test(`the host's link click follows in ${mode} mode`, async ({ page }) => {
			await ep.setPresentationMode(mode);
			await page.locator(LINK).click({ modifiers: ['ControlOrMeta'] });
			expect(await followed(page)).toEqual(['notes']);
		});
	}

	test('reading mode: a plain click follows, and so does Enter on the focused link', async ({
		page
	}) => {
		await ep.setPresentationMode('reading');
		await page.locator(LINK).click();
		await page.locator(LINK).focus();
		await page.keyboard.press('Enter');
		expect(await followed(page)).toEqual(['notes', 'notes']);
	});

	test('a key that is no Enter or Space follows nothing', async ({ page }) => {
		await ep.setPresentationMode('reading');
		await page.locator(LINK).focus();
		await page.keyboard.press('a');
		expect(await followed(page)).toEqual([]);
	});
});

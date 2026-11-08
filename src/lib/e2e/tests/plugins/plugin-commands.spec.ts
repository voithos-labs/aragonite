import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage, capturedErrors } from './helpers';
import { gotoReady } from '../../goto-ready';
import { edgeKey } from '../../platform-keys';

// The chord-count plugin counts its command's chord presses per editor label in
// `window.__chordCounts` (requirements/plugins/plugin-commands.md).

const counts = (page: Page): Promise<Record<string, number>> =>
	page.evaluate(() => ({ ...(window.__chordCounts ?? {}) }));

test.describe("a plugin value's command chord: one editor", () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('docstats');
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('Mod+Shift+S from a focused paragraph runs the command once', async ({ page }) => {
		await editor.clickBlock(0);
		await page.keyboard.press('ControlOrMeta+Shift+S');
		await expect.poll(() => counts(page)).toEqual({ default: 1 });
	});

	test('the command still runs after an Enter split and an undo', async ({ page }) => {
		await editor.clickBlock(0);
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(3);
		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForBlockCount(2);

		await page.keyboard.press('ControlOrMeta+Shift+S');
		await expect.poll(() => counts(page)).toEqual({ default: 1 });
	});
});

test('with two editors, the chord runs only in the one holding the caret', async ({ page }) => {
	await gotoReady(page, '/test/plugins/multi');
	await page.locator('.editor').nth(1).getByText('Para').click();
	await page.keyboard.press('ControlOrMeta+Shift+S');

	await expect.poll(() => counts(page)).toEqual({ right: 1 });
	expect(await capturedErrors(page)).toEqual([]);
});

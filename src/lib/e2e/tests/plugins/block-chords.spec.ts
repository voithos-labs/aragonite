import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';
import { edgeKey } from '../../platform-keys';

// The alerts plugin's `%> [!TYPE]` container takes Mod+7 and offers a menu row, each running its
// command on the alert (requirements/plugins/block-chords.md).

const SEED = 'intro\n\n%> [!NOTE]\n%> inside\n\nafter\n';

test.describe("a block type's key", () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('alerts');
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('Mod+7 in the paragraph inside the alert cycles its type, one undo step', async ({
		page
	}) => {
		await page.getByText('inside').click();
		await page.keyboard.press('ControlOrMeta+7');
		await expect.poll(() => editor.bridge.getSource()).toContain('%> [!TIP]\n%> inside\n');
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => editor.bridge.getSource()).toBe(SEED);
	});

	test('Mod+7 in a paragraph outside the alert changes nothing', async ({ page }) => {
		await page.getByText('after').click();
		await page.keyboard.press('ControlOrMeta+7');
		await expect.poll(() => editor.bridge.getSource()).toBe(SEED);
	});

	test("Enter in the alert's paragraph still splits it, a key the paragraph binds itself", async ({
		page
	}) => {
		await page.getByText('inside').click();
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('Enter');
		await page.keyboard.type('more');
		await expect.poll(() => editor.bridge.getSource()).toContain('%> [!NOTE]\n%> inside\n');
		await expect.poll(() => editor.bridge.getSource()).toContain('more');
		expect(await editor.bridge.getSource()).not.toContain('[!TIP]');
	});
});

test.describe("a block type's menu rows", () => {
	let editor: PluginsPage;
	const blockMenu = (page: Page) => page.getByRole('menu', { name: 'Block actions' });

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('alerts');
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test("a block picked up whole lists its type's row before Copy, and the row runs on it", async ({
		page
	}) => {
		await editor.loadContent('intro\n\n[[flag off]]\n\nafter\n');
		await page.getByText('[[flag off]]').click({ button: 'right' });
		await expect(blockMenu(page).getByRole('menuitem')).toHaveText([
			'Toggle flag',
			'Copy flag',
			'Replace with clipboard',
			'Remove flag'
		]);
		await blockMenu(page).getByRole('menuitem', { name: 'Toggle flag' }).click();
		await expect.poll(() => editor.bridge.getSource()).toBe('intro\n\n[[flag on]]\n\nafter\n');
	});

	for (const [where, source, text, cycled] of [
		['the alert', SEED, 'inside', '%> [!TIP]\n%> inside\n'],
		[
			'an alert in a list item',
			'- item\n\n  %> [!NOTE]\n  %> nested inside\n',
			'nested inside',
			'  %> [!TIP]\n  %> nested inside\n'
		]
	]) {
		test(`a right-click in ${where}'s text leads with its type's rows as one flyout`, async ({
			page
		}) => {
			if (source !== SEED) await editor.loadContent(source);
			await page.getByText(text).click({ button: 'right' });
			const rows = blockMenu(page).getByRole('menuitem');
			await expect(rows.first()).toHaveText('Alert');
			await expect(rows.nth(1)).toHaveText('Cut');
			await rows.first().hover();
			await page.getByRole('menuitem', { name: 'Next kind' }).click();
			await expect.poll(() => editor.bridge.getSource()).toContain(cycled);
		});
	}
});

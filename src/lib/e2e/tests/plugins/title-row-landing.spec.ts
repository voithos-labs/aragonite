import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { wholeBlockInput } from '../../whole-block-input';

// Backspace on the first block under a `:::` title row, then a letter (`requirements/plugins/
// title-row-landing.md`). The core's places per kind and gesture are `test/range-edit/
// title-row-landing.test.ts`.

const ROWS = [
	['no title', ':::note', { live: ':::note\n\nxpara\n:::\n', source: ':::notex\n\npara\n:::\n' }],
	[
		'no title, in a plugin container',
		':::callout',
		{ live: ':::callout\n\nxpara\n:::\n', source: ':::calloutx\n\npara\n:::\n' }
	],
	[
		'a title',
		':::note Title',
		{ live: ':::note Titlex\n\npara\n:::\n', source: ':::note Titlex\n\npara\n:::\n' }
	]
] as const;

test.describe('Backspace on the first block under a `:::` title row', () => {
	for (const mode of ['live', 'source'] as const) {
		for (const [name, row, typed] of ROWS) {
			test(`(${mode}) a rule under a row with ${name}, then a letter`, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.setPresentationMode(mode);
				await editor.loadContent(`${row}\n---\n\npara\n:::\n`);
				await editor.clickBlockAtPath([0, 2], 0);
				await page.keyboard.press('ArrowUp');
				await expect(wholeBlockInput(page.locator('.thematic-break-block'))).toBeFocused();

				await page.keyboard.press('Backspace');
				await editor.bridge.waitForSourceNotContains('---');
				await page.keyboard.type('x');
				await editor.bridge.waitForSourceEquals(typed[mode]);
			});
		}
	}

	test('(live) a rule after an empty container with no title, then a letter', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await editor.setPresentationMode('live');
		await editor.loadContent(':::note\n:::\n\n---\n\npara\n');
		await editor.clickBlockAtPath([2], 0);
		await page.keyboard.press('ArrowUp');
		await expect(wholeBlockInput(page.locator('.thematic-break-block'))).toBeFocused();

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('---');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals(':::note\n\nx\n:::\n\npara\n');
	});
});

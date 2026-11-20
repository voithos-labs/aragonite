import { test, expect } from '../../fixtures';
import { wholeBlockInput } from '../../whole-block-input';
import { PluginsPage } from './helpers';

// A cut pasted straight back gives the document back, wherever the cut left its caret: on the next
// block's text, or beside a block focused whole (`requirements/plugins/cut-paste-back.md`).

const RANGES = [
	{
		name: 'a range through a heading, a heading after',
		doc: 'first\n\n***\n\n# hd\n\n# h\n'
	},
	{
		name: 'a range through a heading, a titled callout after',
		doc: 'first\n\n***\n\n# hd\n\n:::tip Title\nin\n:::\n'
	}
];

const FOCUSED = [
	{ name: 'a divider ending an untitled callout', doc: ':::tip\n***\n:::\n' },
	{ name: 'a divider after a table of contents', doc: '[[toc]]\n\n***\n' }
];

for (const mode of ['live', 'source'] as const)
	test.describe(`a cut pasted straight back, ${mode}`, () => {
		for (const row of RANGES)
			test(row.name, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.doc);
				await editor.focusBlockAtPath([0], 0);
				await editor.bridge.setSelection({
					anchor: { path: [1], offset: 0 },
					focus: { path: [2], offset: 4 }
				});
				await page.keyboard.press('ControlOrMeta+x');
				await editor.bridge.waitForSourceNotContains('***');
				await editor.paste();
				await editor.bridge.waitForSourceEquals(row.doc);
			});
		for (const row of FOCUSED)
			test(`${row.name}, focused whole`, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.doc);
				const rule = page.locator('.thematic-break-block');
				await rule.click();
				await expect(wholeBlockInput(rule)).toBeFocused();
				await page.keyboard.press('ControlOrMeta+x');
				await editor.bridge.waitForSourceNotContains('***');
				await editor.paste();
				await editor.bridge.waitForSourceEquals(row.doc);
			});
	});

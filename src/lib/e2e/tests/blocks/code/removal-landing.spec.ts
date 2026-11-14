import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import type { PresentationMode } from '../../../../presentation-mode';
import { PluginsPage } from '../../plugins/helpers';

// Delete over a range that ends in a fence's body, the fence it empties taking the caret: the
// fence gets its body line back and the next letter lands there, with no language picker opened.
// The plugins harness hosts the callout.
// Requirements: `e2e/requirements/blocks/code/removal-landing.md`.

const picker = (page: Page) => page.locator('.code-lang-picker');

async function load(page: Page, mode: PresentationMode, doc: string): Promise<PluginsPage> {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins();
	await editor.setPresentationMode(mode);
	await editor.loadContent(doc);
	return editor;
}

interface Row {
	name: string;
	doc: string;
	/** The range's start, at the first fence's opener, and its end inside the second fence's body. */
	from: { path: number[]; offset: number };
	to: { path: number[]; offset: number };
	/** A block outside the range, where the caret waits while the range is put down. */
	elsewhere: number[];
	after: string;
}

const ROWS: Row[] = [
	{
		name: 'at the top level',
		doc: '```\nx\n```\n~~~\ny\n~~~\n\nafter\n',
		from: { path: [0], offset: 0 },
		to: { path: [1], offset: 5 },
		elsewhere: [2],
		after: '~~~\nq\n~~~\n\nafter\n'
	},
	{
		name: 'with a language',
		doc: '```\nx\n```\n~~~js\ny\n~~~\n\nafter\n',
		from: { path: [0], offset: 0 },
		to: { path: [1], offset: 7 },
		elsewhere: [2],
		after: '~~~js\nq\n~~~\n\nafter\n'
	},
	{
		name: 'in a callout',
		doc: ':::note\n```\nx\n```\n~~~\ny\n~~~\n:::\n\nafter\n',
		from: { path: [0, 1], offset: 0 },
		to: { path: [0, 2], offset: 5 },
		elsewhere: [1],
		after: ':::note\n~~~\nq\n~~~\n:::\n\nafter\n'
	}
];

for (const mode of ['live', 'source'] as const)
	test.describe(`a removal that empties a fence, ${mode}`, () => {
		for (const row of ROWS) {
			// The fence's block has never had focus: the range goes down from a caret elsewhere.
			test(`${row.name}, a fence never focused`, async ({ page }) => {
				const editor = await load(page, mode, row.doc);
				await editor.focusBlockAtPath(row.elsewhere, 0);
				await editor.bridge.setSelection({ anchor: row.from, focus: row.to });
				expect(await editor.bridge.getSelection()).toMatchObject({
					anchor: row.from,
					focus: row.to
				});
				await page.keyboard.press('Delete');
				await page.keyboard.type('q');
				await editor.bridge.waitForSourceEquals(row.after);
				await expect(picker(page)).toHaveCount(0);
			});

			// A click in the first fence focuses it before the range goes down.
			test(`${row.name}, a fence focused first`, async ({ page }) => {
				const editor = await load(page, mode, row.doc);
				await editor.clickBlockAtPath(row.from.path, 4);
				await editor.bridge.setSelection({ anchor: row.from, focus: row.to });
				expect(await editor.bridge.getSelection()).toMatchObject({
					anchor: row.from,
					focus: row.to
				});
				await page.keyboard.press('Delete');
				await page.keyboard.type('q');
				await editor.bridge.waitForSourceEquals(row.after);
				await expect(picker(page)).toHaveCount(0);
			});
		}
	});

// Typing a fence's opener is authoring it: live mode opens the picker on the new fence, and the
// letters after a language and Enter land in the body.
test.describe('typing a fence opener, live', () => {
	for (const [name, opener, after] of [
		['no language', '```', 'para\n\n```\nq\n```\n'],
		['a language', '```js', 'para\n\n```js\nq\n```\n']
	] as const)
		test(name, async ({ page }) => {
			const editor = await load(page, 'live', 'para\n\n\n');
			await editor.focusBlockAtPath([1], 0);
			await page.keyboard.type('```');
			await expect(picker(page)).toHaveCount(1);
			await page.keyboard.type(opener.slice(3));
			await page.keyboard.press('Enter');
			await page.keyboard.type('q');
			await editor.bridge.waitForSourceEquals(after);
		});
});

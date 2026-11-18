import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// Backspace at a block's start or Delete at its end that joins nothing, then a letter: the caret
// lands off the syntax beside it (`requirements/plugins/plain-key-landing.md`).

interface Row {
	name: string;
	doc: string;
	at: { path: number[]; offset: number };
	key: string;
	after: string;
	modes?: ('live' | 'source')[];
}

const ROWS: Row[] = [
	{
		name: 'Backspace at a callout body’s start holds the gap under its opening line',
		doc: ':::tip\nin\n:::\n',
		at: { path: [0, 1], offset: 0 },
		key: 'Backspace',
		after: ':::tip\n\nq\n\nin\n:::\n'
	},
	{
		name: 'Delete at a paragraph’s end before an untitled callout goes on to its text',
		doc: 'alpha\n\n:::tip\nin\n:::\n',
		at: { path: [0], offset: 5 },
		key: 'Delete',
		after: 'alpha\n\n:::tip\nqin\n:::\n'
	},
	{
		name: 'Delete at a paragraph’s end before a heading lands past its `# `',
		doc: 'alpha\n\n# h\n',
		at: { path: [0], offset: 5 },
		key: 'Delete',
		after: 'alpha\n\n# qh\n'
	},
	{
		name: 'Delete before a titled callout lands at its title',
		doc: 'alpha\n\n:::tip Title\nin\n:::\n',
		at: { path: [0], offset: 5 },
		key: 'Delete',
		after: 'alpha\n\n:::tip qTitle\nin\n:::\n'
	},
	{
		name: 'Delete before a table of contents holds the gap above it',
		doc: 'alpha\n\n[[toc]]\n',
		at: { path: [0], offset: 5 },
		key: 'Delete',
		after: 'alpha\n\nq\n\n[[toc]]\n'
	},
	{
		name: 'Backspace after a table of contents holds the gap below it',
		doc: '[[toc]]\n\nalpha\n',
		at: { path: [1], offset: 0 },
		key: 'Backspace',
		after: '[[toc]]\n\nq\n\nalpha\n'
	},
	{
		name: 'Delete before a `$$` block lands in its body',
		doc: 'alpha\n\n$$\nm\n$$\n',
		at: { path: [0], offset: 5 },
		key: 'Delete',
		after: 'alpha\n\n$$\nqm\n$$\n'
	},
	{
		name: 'Backspace after a `$$` block lands at its body’s end',
		doc: '$$\nm\n$$\n\nalpha\n',
		at: { path: [1], offset: 0 },
		key: 'Backspace',
		after: '$$\nmq\n$$\n\nalpha\n'
	},
	{
		name: 'Backspace after a one-line `$$` block lands at its formula’s end',
		doc: '$$m$$\n\nalpha\n',
		at: { path: [1], offset: 0 },
		key: 'Backspace',
		after: '$$mq$$\n\nalpha\n'
	},
	{
		name: 'Enter at a heading’s text start moves it down, the caret past its `# `',
		doc: '# head\n\nafter\n',
		at: { path: [0], offset: 2 },
		key: 'Enter',
		after: '\n# qhead\n\nafter\n'
	}
];

async function load(page: import('@playwright/test').Page, mode: 'live' | 'source', doc: string) {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins();
	await editor.setPresentationMode(mode);
	await editor.loadContent(doc);
	return editor;
}

for (const mode of ['live', 'source'] as const)
	test.describe(`a plain key beside syntax, ${mode}`, () => {
		for (const row of ROWS)
			test(row.name, async ({ page }) => {
				const editor = await load(page, mode, row.doc);
				await editor.focusBlockAtPath(row.at.path, row.at.offset);
				await page.keyboard.press(row.key);
				await page.keyboard.type('q');
				// A `$$` body commits its source when the caret leaves it.
				await page.mouse.click(5, 5);
				await editor.bridge.waitForSourceEquals(row.after);
			});

		// The gap a key that removed nothing holds is the gap page's: drawn, no undo entry, left by
		// the keys that leave any gap.
		test('the gap under a callout’s row is drawn, records nothing, and is left as any gap', async ({
			page
		}) => {
			const editor = await load(page, mode, ':::tip\nin\n:::\n');
			await editor.focusBlockAtPath([0, 1], 0);
			const depth = await editor.bridge.getUndoDepth();
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForGapCaret({ parentPath: [0], index: 1, held: true });
			await expect(page.locator('[data-gap-caret]')).toHaveCount(1);
			expect(await editor.bridge.getUndoDepth()).toBe(depth);
			await page.keyboard.press('ArrowDown');
			expect(await editor.bridge.getSelection()).toMatchObject({
				focus: { path: [0, 1], offset: 0 }
			});
		});
	});

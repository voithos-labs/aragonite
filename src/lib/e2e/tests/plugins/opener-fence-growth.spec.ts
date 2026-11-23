import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Typing that grows or nests a `:::` fence, key by key in both modes: the caret stays where the
 * key typed, as an exact byte, and the tree reads as a reload would. Requirements:
 * e2e/requirements/plugins/opener-fence-growth.md.
 */

const NEST = '::::note Outer\n:::tip Inner\nin\n:::\n::::\n';
const GROWN = ':::::note Outer\n::::tip Inner\nin\n::::\n:::::\n';
const CONTAINER = [':::tip', 'Enter', 'in', 'Enter', ':::'];

interface Row {
	name: string;
	source: string;
	at: [number[], number];
	keys: string[];
	bytes: string;
	caret: string;
}

const ROWS: Row[] = [
	{
		name: 'a closing line typed in a body grows the fence',
		source: ':::note\nbody\n:::\n',
		at: [[0, 1], 4],
		keys: ['Enter', ':::'],
		bytes: '::::note\nbody\n\n:::\n::::\n',
		caret: '[0,2]:3'
	},
	{
		name: 'a colon at a nested row start grows both fences',
		source: NEST,
		at: [[0, 1, 0], 0],
		keys: [':'],
		bytes: GROWN,
		caret: '[0,1,0]:1'
	},
	{
		name: 'a colon in a nested row marker grows both fences',
		source: NEST,
		at: [[0, 1, 0], 3],
		keys: [':'],
		bytes: GROWN,
		caret: '[0,1,0]:4'
	},
	{
		name: 'a container typed as a body first line is read at its closer',
		source: '::::note\n\n::::\n',
		at: [[0, 1], 0],
		keys: CONTAINER,
		bytes: '::::note\n\n:::tip\n\nin\n\n:::\n::::\n',
		caret: '[0,1,1]:2'
	},
	{
		name: 'a container typed after a body line is read at its closer',
		source: '::::note\nbody\n::::\n',
		at: [[0, 1], 4],
		keys: ['Enter', ...CONTAINER],
		bytes: '::::note\nbody\n\n:::tip\n\nin\n\n:::\n::::\n',
		caret: '[0,2,1]:2'
	}
];

async function caretText(page: Page): Promise<string> {
	return page.evaluate(() => {
		const sel = (window as any).__test.getSelection();
		if (!sel) return 'none';
		const p = (q: { path: number[]; offset: number }) => `${JSON.stringify(q.path)}:${q.offset}`;
		return p(sel.anchor) === p(sel.focus) ? p(sel.focus) : `${p(sel.anchor)}..${p(sel.focus)}`;
	});
}

for (const mode of ['source', 'live'] as const) {
	test.describe(`typing that grows or nests a ::: fence, ${mode} mode`, () => {
		for (const row of ROWS) {
			test(row.name, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins('admonitions');
				await editor.loadContent(row.source);
				await editor.setPresentationMode(mode);
				await editor.focusBlockAtPath(row.at[0], row.at[1]);
				for (const key of row.keys) {
					if (key === 'Enter') await page.keyboard.press(key);
					else await page.keyboard.type(key);
					await editor.waitForRenderFlush();
				}
				await expect.poll(() => caretText(page)).toBe(row.caret);
				expect(await page.evaluate(() => (window as any).__test.getSource())).toBe(row.bytes);
				expect(await editor.parseConverged()).toBe(true);
			});
		}
	});
}

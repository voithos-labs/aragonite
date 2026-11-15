import { test, expect } from '../../fixtures';
import { edgeKey } from '../../platform-keys';
import { PluginsPage } from '../plugins/helpers';

// Windows clipboard writes CRLF, so every source read normalizes before comparing.
const asLf = (src: string) => src.replace(/\r\n/g, '\n');

/** Each host's `alpha` ends its container's last paragraph; `path` is that paragraph's, or null
 *  where a click on the word places the caret. */
const ROWS: [name: string, doc: string, path: number[] | null, clip: string, typed: string][] = [
	['a quote', '> alpha\n\nAfter\n', [0, 0], 'one\n', '> alphaone\n>\n> Z\n\nAfter\n'],
	[
		'an alert',
		'> [!NOTE]\n> alpha\n\nAfter\n',
		[0, 0],
		'one\n',
		'> [!NOTE]\n> alphaone\n>\n> Z\n\nAfter\n'
	],
	[
		'a callout',
		':::note\nalpha\n:::\n\nAfter\n',
		[0, 1],
		'one\n',
		':::note\nalphaone\n\nZ\n:::\n\nAfter\n'
	],
	[
		'a footnote',
		'a[^1]\n\n[^1]: alpha\n\nAfter\n',
		[1],
		'one\n',
		'a[^1]\n\n[^1]: alphaone\n\nZ\n\nAfter\n'
	],
	[
		'a quote in an item',
		'- > alpha\n- after\n',
		[0, 0, 0, 0],
		'one\n',
		'- > alphaone\n  >\n  > Z\n- after\n'
	],
	[
		'an open details',
		'<details open>\n<summary>S</summary>\n\nalpha\n\n</details>\n\nAfter\n',
		null,
		'one\n',
		'<details open>\n<summary>S</summary>\n\nalphaone\n\nZ\n</details>\n\nAfter\n'
	],
	[
		'a quote joined into the quote',
		'> alpha\n>\n> after\n',
		[0, 0],
		'> one\n',
		'> alphaone\n>\n> Z\n>\n> after\n'
	]
];

for (const [name, doc, path, clip, typed] of ROWS)
	test(`a line ending pasted at the end of ${name}'s last paragraph opens its empty line`, async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await editor.loadContent(doc);
		if (path) await editor.focusBlockAtPath(path, 0);
		else {
			const rect = await page.evaluate(() => (window as any).__test.textRunRect('alpha'));
			await page.mouse.click(rect.left + 2, rect.top + rect.height / 2);
		}
		await page.keyboard.press(edgeKey('lineEnd'));
		await editor.seedClipboard(clip);
		await editor.paste();
		await editor.bridge.waitForSourceContains('alphaone');
		expect(await editor.parseConverged()).toBe(true);
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z');
		expect(asLf(await editor.bridge.getSource())).toBe(typed);
		expect(await editor.parseConverged()).toBe(true);
	});

/** A block pasted with its line ending at the end of each host's last paragraph. */
const BLOCK_ROWS: [name: string, doc: string, path: number[], clip: string, typed: string][] = [
	[
		'a rule in a quote',
		'> alpha\n\nAfter\n',
		[0, 0],
		'***\n',
		'> alpha\n>\n> ***\n>\n> Z\n\nAfter\n'
	],
	[
		'a fence in a callout',
		':::note\nalpha\n:::\n\nAfter\n',
		[0, 1],
		'```\nq\n```\n',
		':::note\nalpha\n\n```\nq\n```\n\nZ\n:::\n\nAfter\n'
	]
];

for (const [name, doc, path, clip, typed] of BLOCK_ROWS)
	test(`${name} pasted with its line ending at the end: a letter takes the ending's line`, async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await editor.loadContent(doc);
		await editor.focusBlockAtPath(path, 0);
		await page.keyboard.press(edgeKey('lineEnd'));
		await editor.seedClipboard(clip);
		await editor.paste();
		await editor.bridge.waitForSourceContains(clip.split('\n')[0]);
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z');
		expect(asLf(await editor.bridge.getSource())).toBe(typed);
		expect(await editor.parseConverged()).toBe(true);
	});

import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// Shift+Enter on a title row writes nothing, and a pasted line break becomes a space
// (`requirements/plugins/title-row-one-line.md`). Every other route to the row's line is
// `test/blocks/title-row-one-line.test.ts`.

const T = ':::tip Title\nbody\n:::\n';
const U = ':::tip\nbody\n:::\n';
const N = '::::note Outer\n:::tip Inner\nin\n:::\n::::\n';
const D = '<details open>\n<summary>Summary</summary>\n\nbody\n</details>\n';

/** [name, document, the row's path, where the row starts in the document, the body block the
 *  walk starts from, ArrowLeft presses from there] */
const ROWS: [string, string, number[], number, number[], number][] = [
	['before the colons', T, [0, 0], 0, [0, 1], 13],
	['between the colons', T, [0, 0], 0, [0, 1], 12],
	['between the colons and the name', T, [0, 0], 0, [0, 1], 10],
	['inside the name', T, [0, 0], 0, [0, 1], 8],
	['between the name and the title', T, [0, 0], 0, [0, 1], 7],
	['at the title’s start', T, [0, 0], 0, [0, 1], 6],
	['inside the title', T, [0, 0], 0, [0, 1], 4],
	['an untitled row, before the colons', U, [0, 0], 0, [0, 1], 7],
	['an untitled row, at the name’s start', U, [0, 0], 0, [0, 1], 4],
	['an untitled row, inside the name', U, [0, 0], 0, [0, 1], 2],
	['a nested row, inside the title', N, [0, 1, 0], 15, [0, 1, 1], 4],
	['a details summary, inside it', D, [0, 0], 24, [0, 1], 5]
];

const PASTED = ROWS.filter(([name]) => /inside the title|inside it/.test(name));

test.describe('A pasted line ending in a backslash, on a title row', () => {
	for (const mode of ['live', 'source'] as const)
		for (const [name, source, row, rowStart, body, lefts] of PASTED)
			test(`(${mode}) ${name} keeps the backslash and spaces the break`, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.setPresentationMode(mode);
				await editor.loadContent(source);
				await editor.focusBlockAtPath(body, 0);
				for (let i = 0; i < lefts; i++) await page.keyboard.press('ArrowLeft');
				const placed = await editor.bridge.getSelection();
				expect(placed?.focus.path).toEqual(row);
				await editor.seedClipboard('C:\\dir\\\nnext');

				await editor.paste();

				const at = rowStart + placed!.focus.offset;
				const pasted = 'C:\\dir\\ next';
				await editor.bridge.waitForSourceEquals(source.slice(0, at) + pasted + source.slice(at));
				expect((await editor.bridge.getSelection())?.focus.offset).toBe(
					placed!.focus.offset + pasted.length
				);
			});
});

test.describe('Shift+Enter on a title row', () => {
	for (const mode of ['live', 'source'] as const)
		for (const [name, source, row, rowStart, body, lefts] of ROWS)
			test(`(${mode}) ${name} writes nothing and keeps the caret`, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.setPresentationMode(mode);
				await editor.loadContent(source);
				await editor.focusBlockAtPath(body, 0);
				for (let i = 0; i < lefts; i++) await page.keyboard.press('ArrowLeft');
				const placed = await editor.bridge.getSelection();
				expect(placed?.focus.path).toEqual(row);
				const depth = await editor.bridge.getUndoDepth();

				await editor.pressDeclined('Shift+Enter');

				expect(await editor.bridge.getSource()).toBe(source);
				expect(await editor.bridge.getUndoDepth()).toBe(depth);
				expect(await editor.bridge.getSelection()).toEqual(placed);
				// The caret is where it was: a letter goes in there.
				const at = rowStart + placed!.focus.offset;
				await page.keyboard.type('x');
				await editor.bridge.waitForSourceEquals(source.slice(0, at) + 'x' + source.slice(at));
			});
});

import { test, expect } from '../../fixtures';
import { attachIme } from '../../simulation/ime';
import { PluginsPage } from './helpers';

// A range that runs onto a title row from outside clears the title part it covers and keeps the
// marker (`requirements/plugins/title-row-entered-range.md`); its bytes are
// `test/range-edit/named-rows-closers.ts`.

const A = 'above\n\n:::tip Title\nbody\n:::\n\nend\n';
const CLEARED = 'ab\n\n:::tip \ndy\n:::\n\nend\n';
type Mode = 'live' | 'source';
const MODES = ['live', 'source'] as const;

async function open(
	page: import('@playwright/test').Page,
	mode: Mode,
	source = A,
	seed = 'admonitions'
) {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins(seed);
	await editor.setPresentationMode(mode);
	await editor.loadContent(source);
	return editor;
}

/** Drags from `above`'s `ab|` to `bo|dy`, through the title row. */
async function selectAcross(editor: PluginsPage) {
	await editor.dragFromTo([0], 2, [1, 1], 2);
	await editor.waitForCrossBlock(true);
}

/** [name, what is done over the range, the bytes after] */
const OVER_RANGE: [string, (editor: PluginsPage) => Promise<void>, string][] = [
	['Backspace', (e) => e.page.keyboard.press('Backspace'), CLEARED],
	['Delete', (e) => e.page.keyboard.press('Delete'), CLEARED],
	['a letter', (e) => e.page.keyboard.type('Q'), 'abQ\n\n:::tip \ndy\n:::\n\nend\n'],
	['Enter', (e) => e.page.keyboard.press('Enter'), 'ab\n\n\n:::tip \ndy\n:::\n\nend\n'],
	[
		'a paste',
		async (e) => {
			await e.seedClipboard('X');
			await e.paste();
		},
		'abX\n\n:::tip \ndy\n:::\n\nend\n'
	],
	[
		'an IME composition',
		async (e) => {
			const ime = await attachIme(e.page);
			await ime.compose('q');
			await ime.commit('q');
		},
		'abq\n\n:::tip \ndy\n:::\n\nend\n'
	]
];

test.describe('A range from above through a title row into the body', () => {
	for (const mode of MODES) {
		for (const [name, act, bytes] of OVER_RANGE)
			test(`(${mode}) ${name} clears the title and keeps the marker`, async ({ page }) => {
				const editor = await open(page, mode);
				await selectAcross(editor);
				await act(editor);
				await editor.bridge.waitForSourceEquals(bytes);
			});

		test(`(${mode}) the same range made by Shift+ArrowDown`, async ({ page }) => {
			const editor = await open(page, mode);
			await editor.focusBlockAtPath([0], 2);
			for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals('ab\n\n:::tip \nbody\n:::\n\nend\n');
		});

		test(`(${mode}) a cut pasted back gives the document back`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectAcross(editor);
			await page.keyboard.press('ControlOrMeta+x');
			await editor.bridge.waitForSourceEquals(CLEARED);
			await editor.paste();
			await editor.bridge.waitForSourceEquals(A);
		});

		test(`(${mode}) a cut pasted elsewhere moves the title, never doubles it`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectAcross(editor);
			await page.keyboard.press('ControlOrMeta+x');
			await editor.bridge.waitForSourceEquals(CLEARED);
			await editor.focusBlockAtPath([2], 3);
			await page.keyboard.press('Enter');
			await editor.paste();
			await editor.bridge.waitForSourceEquals(`${CLEARED}\nove\n\n:::tip Title\nbo\n:::\n`);
		});

		test(`(${mode}) undo gives the title back and redo clears it again`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectAcross(editor);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(CLEARED);
			await editor.undo();
			await editor.bridge.waitForSourceEquals(A);
			await page.keyboard.press('ControlOrMeta+y');
			await editor.bridge.waitForSourceEquals(CLEARED);
		});
	}
});

/** [name, document, seed, the range's start and end, the bytes Backspace leaves] */
const SHAPES: [string, string, string, [number[], number, number[], number], string][] = [
	[
		'a generic box',
		'above\n\n:::foo Title\nbody\n:::\n',
		'admonitions',
		[[0], 2, [1, 1], 2],
		'ab\n\n:::foo \ndy\n:::\n'
	],
	[
		'a nested box, both titles',
		'above\n\n::::note Outer\n:::tip Inner\nbody\n:::\n::::\n',
		'admonitions',
		[[0], 2, [1, 1, 1], 2],
		'ab\n\n::::note \n:::tip \ndy\n:::\n::::\n'
	],
	[
		'the inner box from the outer body',
		'::::note Outer\nabove\n\n:::tip Inner\nbody\n:::\n::::\n',
		'admonitions',
		[[0, 1], 2, [0, 2, 1], 2],
		'::::note Outer\nab\n\n:::tip \ndy\n:::\n::::\n'
	],
	[
		'in a quote',
		'> above\n>\n> :::tip Title\n> body\n> :::\n',
		'admonitions',
		[[0, 0], 2, [0, 1, 1], 2],
		'> ab\n>\n> :::tip \n> dy\n> :::\n'
	],
	[
		'in a list item',
		'- above\n\n  :::tip Title\n  body\n  :::\n',
		'admonitions',
		[[0, 0, 0], 2, [0, 0, 1, 1], 2],
		'- ab\n\n  :::tip \n  dy\n  :::\n'
	],
	[
		'from another box',
		':::note A\nfirst\n:::\n\n:::tip B\nbody\n:::\n',
		'admonitions',
		[[0, 1], 2, [1, 1], 2],
		':::note A\nfi\n:::\n\n:::tip \ndy\n:::\n'
	],
	[
		'a details summary',
		'above\n\n<details open>\n<summary>Sum</summary>\n\nbody\n\n</details>\n',
		'details',
		[[0], 2, [1, 1], 2],
		'ab\n\n<details open>\n<summary></summary>\ndy\n\n</details>\n'
	]
];

test.describe('The shapes a range clears a title on', () => {
	for (const mode of MODES)
		for (const [name, source, seed, [a, at, b, bt], bytes] of SHAPES)
			test(`(${mode}) ${name}`, async ({ page }) => {
				const editor = await open(page, mode, source, seed);
				await editor.dragFromTo(a, at, b, bt);
				await editor.waitForCrossBlock(true);
				await page.keyboard.press('Backspace');
				await editor.bridge.waitForSourceEquals(bytes);
			});
});

test.describe('A range from the body up into the title', () => {
	const UP = ':::tip Title\nbody\n:::\n\nend\n';
	for (const mode of MODES)
		test(`(${mode}) a cut pasted elsewhere carries only the title part it took`, async ({
			page
		}) => {
			const editor = await open(page, mode, UP);
			await editor.dragFromTo([0, 1], 2, [0, 0], 9);
			await editor.waitForCrossBlock(true);
			await page.keyboard.press('ControlOrMeta+x');
			await editor.bridge.waitForSourceEquals(':::tip Ti\ndy\n:::\n\nend\n');
			await editor.focusBlockAtPath([1], 3);
			await page.keyboard.press('Enter');
			await editor.paste();
			await editor.bridge.waitForSourceEquals(':::tip Ti\ndy\n:::\n\nend\n\n:::tip tle\nbo\n:::\n');
		});
});

test.describe('What stays as it was', () => {
	for (const mode of MODES) {
		test(`(${mode}) an untitled row keeps its name`, async ({ page }) => {
			const editor = await open(page, mode, 'above\n\n:::tip\nbody\n:::\n');
			await selectAcross(editor);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals('ab\n\n:::tip\ndy\n:::\n');
		});

		test(`(${mode}) a range that ends inside the title keeps the rest of it`, async ({ page }) => {
			const editor = await open(page, mode);
			await editor.dragFromTo([0], 2, [1, 0], 9);
			await editor.waitForCrossBlock(true);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals('ab\n\n:::tip tle\nbody\n:::\n\nend\n');
			expect(await editor.bridge.getSource()).toContain(':::\n');
		});
	}
});

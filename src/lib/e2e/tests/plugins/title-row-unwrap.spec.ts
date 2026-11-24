import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { attachIme } from '../../simulation/ime';
import { keylessEdit } from '../../insert-text';
import { pointAtRaw } from '../../text-runs';
import { PluginsPage } from './helpers';

// A selection removed from a `:::` opening row that leaves it fewer than three colons unwraps the
// container: the title's rest, a blank line, the body, no closing line
// (`requirements/plugins/title-row-unwrap.md`). Each byte rule is `test/range-edit/opener-unwrap.test.ts`.

const T = ':::tip Title\nbody\n:::\n';
const UNWRAPPED = 'Title\n\nbody\n';
const HALF_OPEN = '::tip Title\nbody\n:::\n';
type Mode = 'live' | 'source';
const MODES = ['live', 'source'] as const;

const menuItem = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });

async function open(page: Page, mode: Mode, source = T): Promise<PluginsPage> {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins('admonitions');
	await editor.setPresentationMode(mode);
	await editor.loadContent(source);
	return editor;
}

/** Holds the opening row's `:::tip ` as a user does: up from the body, then to the row's start. */
async function selectMarker(editor: PluginsPage, mode: Mode): Promise<void> {
	await editor.focusBlockAtPath([0, 1], 0);
	await editor.page.keyboard.press('ArrowUp');
	if (mode === 'live') await editor.page.keyboard.press('Shift+Home');
	else for (let i = 0; i < 7; i++) await editor.page.keyboard.press('Shift+ArrowRight');
	expect(await editor.page.evaluate(() => getSelection()?.toString())).toBe(':::tip ');
}

/** Selects `[from, to)` of the row at `path` through the selection API, from a caret in the body. */
async function selectRow(editor: PluginsPage, path: number[], from: number, to: number) {
	await editor.focusBlockAtPath([...path.slice(0, -1), path.at(-1)! + 1], 0);
	await editor.bridge.setSelection({ anchor: { path, offset: from }, focus: { path, offset: to } });
}

/** Puts the caret after the row's colons by steps: up from the body, then left or right. */
async function caretAfterColons(editor: PluginsPage, mode: Mode): Promise<void> {
	await editor.focusBlockAtPath([0, 1], 0);
	await editor.page.keyboard.press('ArrowUp');
	const [key, count] = mode === 'live' ? ['ArrowLeft', 4] : ['ArrowRight', 3];
	for (let i = 0; i < count; i++) await editor.page.keyboard.press(key);
}

/** Selects one colon, or the name, by steps from where an arrival rests on the row. */
async function selectInMarker(editor: PluginsPage, mode: Mode, what: 'colon' | 'name') {
	const press = async (key: string, times: number) => {
		for (let i = 0; i < times; i++) await editor.page.keyboard.press(key);
	};
	await editor.focusBlockAtPath([0, 1], 0);
	await press('ArrowUp', 1);
	if (mode === 'source') {
		await press('ArrowRight', what === 'colon' ? 1 : 3);
		await press('Shift+ArrowRight', what === 'colon' ? 1 : 3);
	} else {
		await press('ArrowLeft', what === 'colon' ? 4 : 1);
		await press('Shift+ArrowLeft', what === 'colon' ? 1 : 3);
	}
	const want = what === 'colon' ? ':' : 'tip';
	expect(await editor.page.evaluate(() => getSelection()?.toString())).toBe(want);
}

/** [name, what is done over the selected marker, the bytes after] */
const OVER_MARKER: [string, (editor: PluginsPage) => Promise<void>, string][] = [
	['Backspace', (e) => e.page.keyboard.press('Backspace'), UNWRAPPED],
	['Delete', (e) => e.page.keyboard.press('Delete'), UNWRAPPED],
	['Ctrl+X', (e) => e.page.keyboard.press('ControlOrMeta+x'), UNWRAPPED],
	['a letter', (e) => e.page.keyboard.type('Q'), 'QTitle\n\nbody\n'],
	[
		'Cut from the right-click menu',
		async (e) => {
			const { x, y } = await pointAtRaw(e.page, [0, 0], 2);
			await e.page.mouse.click(x, y, { button: 'right' });
			await menuItem(e.page, 'Cut').click();
		},
		UNWRAPPED
	],
	[
		'an IME composition',
		async (e) => {
			const ime = await attachIme(e.page);
			await ime.compose('q');
			await ime.commit('q');
		},
		'qTitle\n\nbody\n'
	]
];

test.describe('A selection that breaks an opening row', () => {
	for (const mode of MODES) {
		for (const [name, act, bytes] of OVER_MARKER)
			test(`(${mode}) ${name} over the marker unwraps the box`, async ({ page }) => {
				const editor = await open(page, mode);
				await selectMarker(editor, mode);
				await act(editor);
				await editor.bridge.waitForSourceEquals(bytes);
			});

		test(`(${mode}) a selection made by the API, then Backspace`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectRow(editor, [0, 0], 0, 3);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(UNWRAPPED);
		});

		test(`(${mode}) Shift+Enter over the marker removes it first`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectMarker(editor, mode);
			await page.keyboard.press('Shift+Enter');
			await editor.bridge.waitForSource((source) => !source.endsWith(':::\n'));
			expect(await editor.bridge.getSource()).not.toContain(':::');
		});
	}
});

/** [name, document, the path of its row, the selection on it, the bytes Backspace leaves] */
const SHAPES: [string, string, number[], number, number, string][] = [
	['the untitled row whole', ':::tip\nbody\n:::\n', [0, 0], 0, 6, 'body\n'],
	[
		'the inner box only',
		'::::note Outer\n:::tip Inner\nin\n:::\n::::\n',
		[0, 1, 0],
		0,
		7,
		'::::note Outer\nInner\n\nin\n::::\n'
	],
	['in a quote', '> :::tip Title\n> body\n> :::\n', [0, 0, 0], 0, 7, '> Title\n>\n> body\n'],
	['in a list item', '- :::tip Title\n  body\n  :::\n', [0, 0, 0, 0], 0, 7, '- Title\n\n  body\n'],
	['a generic box', ':::foo Title\nbody\n:::\n', [0, 0], 0, 7, UNWRAPPED],
	['over a heading, which stays flush', ':::tip Title\n# H\n:::\n', [0, 0], 0, 7, 'Title\n# H\n'],
	['over a rule, kept a rule', ':::tip Title\n---\n:::\n', [0, 0], 0, 7, 'Title\n\n---\n']
];

test.describe('The shapes a broken opening row unwraps', () => {
	for (const mode of MODES)
		for (const [name, source, path, from, to, bytes] of SHAPES)
			test(`(${mode}) ${name}`, async ({ page }) => {
				const editor = await open(page, mode, source);
				await selectRow(editor, path, from, to);
				await page.keyboard.press('Backspace');
				await editor.bridge.waitForSourceEquals(bytes);
			});

	for (const mode of MODES)
		test(`(${mode}) one colon selected by keys`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectInMarker(editor, mode, 'colon');
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(UNWRAPPED);
		});

	test('(source) the titled row held whole', async ({ page }) => {
		const editor = await open(page, 'source');
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('body\n');
	});
});

test.describe('After the unwrap', () => {
	for (const mode of MODES) {
		test(`(${mode}) the caret stands at the start of the title`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectMarker(editor, mode);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(UNWRAPPED);
			await page.keyboard.type('x');
			await editor.bridge.waitForSourceEquals('xTitle\n\nbody\n');
		});

		test(`(${mode}) a marker retyped over the selected one loses no character`, async ({
			page
		}) => {
			const editor = await open(page, mode);
			await selectMarker(editor, mode);
			await page.keyboard.type(':');
			await editor.bridge.waitForSourceEquals(':Title\n\nbody\n');
			await page.keyboard.type('::note ');
			await editor.bridge.waitForSourceEquals(':::note Title\n\nbody\n');
		});

		test(`(${mode}) a cut pasted back gives the box back`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectMarker(editor, mode);
			await page.keyboard.press('ControlOrMeta+x');
			await editor.bridge.waitForSourceEquals(UNWRAPPED);
			await page.keyboard.press('ControlOrMeta+v');
			await editor.bridge.waitForSourceEquals(T);
		});

		test(`(${mode}) the marker pasted from elsewhere stays text`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectMarker(editor, mode);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(UNWRAPPED);
			await editor.seedClipboard(':::tip ');
			await editor.paste();
			await editor.bridge.waitForSourceEquals(':::tip Title\n\nbody\n');
		});

		test(`(${mode}) undo gives the box back and redo unwraps it again`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectMarker(editor, mode);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(UNWRAPPED);
			await page.keyboard.press('ControlOrMeta+z');
			await editor.bridge.waitForSourceEquals(T);
			await page.keyboard.press('ControlOrMeta+y');
			await editor.bridge.waitForSourceEquals(UNWRAPPED);
		});
	}
});

test.describe('What stays as it was', () => {
	for (const mode of MODES) {
		test(`(${mode}) the name selected leaves three colons`, async ({ page }) => {
			const editor = await open(page, mode);
			await selectInMarker(editor, mode, 'name');
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals('::: Title\nbody\n:::\n');
		});

		const keys: [string, string, string][] = [
			['Backspace', 'Backspace', HALF_OPEN],
			['a word delete', 'ControlOrMeta+Backspace', 'tip Title\nbody\n:::\n']
		];
		for (const [name, key, bytes] of keys)
			test(`(${mode}) ${name} at a caret after the colons`, async ({ page }) => {
				const editor = await open(page, mode);
				await caretAfterColons(editor, mode);
				await page.keyboard.press(key);
				await editor.bridge.waitForSourceEquals(bytes);
			});

		test(`(${mode}) a soft keyboard delete at that caret`, async ({ page }) => {
			const editor = await open(page, mode);
			await caretAfterColons(editor, mode);
			await keylessEdit(page, 'delete');
			await editor.bridge.waitForSourceEquals(HALF_OPEN);
		});
	}

	test('(live) the titled row held whole clears the title', async ({ page }) => {
		const editor = await open(page, 'live');
		await selectRow(editor, [0, 0], 0, 12);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals(':::tip \nbody\n:::\n');
	});
});

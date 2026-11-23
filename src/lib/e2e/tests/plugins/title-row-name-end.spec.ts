import { test, expect } from '../../fixtures';
import { attachIme } from '../../simulation/ime';
import { PluginsPage } from './helpers';

// Text typed at the end of a bare `:::name` the editor knows starts the title, in both modes
// (`requirements/plugins/title-row-name-end.md`). Each rule's edges are `test/blocks/title-row-name-end.test.ts`.

const U = ':::tip\nbody\n:::\n';
const T = ':::tip Title\nbody\n:::\n';
const F = ':::foo\nbody\n:::\n';

type Act = (editor: PluginsPage) => Promise<void>;

const type =
	(text: string): Act =>
	(editor) =>
		editor.page.keyboard.type(text);

const ime: Act = async (editor) => {
	const driver = await attachIme(editor.page);
	await driver.compose('x');
	// Nothing is written while the composition is open: the gap comes with the commit.
	expect(await editor.bridge.getSource()).toBe(U);
	await driver.commit('x');
};

const paste: Act = async (editor) => {
	await editor.seedClipboard('w');
	await editor.paste();
};

const sixBackspaces: Act = async (editor) => {
	for (let i = 0; i < 6; i++) await editor.page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceEquals(U);
	await editor.page.keyboard.type('x');
};

/** [name, document, what is done at the row's end, the bytes after, the caret's offset after] */
const ROWS: [string, string, Act, string, number][] = [
	['a letter starts the title', U, type('x'), ':::tip x\nbody\n:::\n', 8],
	['a capital starts the title', U, type('X'), ':::tip X\nbody\n:::\n', 8],
	['a digit starts the title', U, type('7'), ':::tip 7\nbody\n:::\n', 8],
	['a dash starts the title', U, type('-'), ':::tip -\nbody\n:::\n', 8],
	['an IME commit starts the title', U, ime, ':::tip x\nbody\n:::\n', 8],
	['a paste starts the title', U, paste, ':::tip w\nbody\n:::\n', 8],
	['six Backspaces from a title, then a letter', T, sixBackspaces, ':::tip x\nbody\n:::\n', 8],
	['a character that cannot join a name goes in as typed', U, type('!'), ':::tip!\nbody\n:::\n', 7],
	['an unknown name grows', F, type('x'), ':::foox\nbody\n:::\n', 7]
];

test.describe('Text at the end of a bare name', () => {
	for (const mode of ['live', 'source'] as const)
		for (const [name, source, act, bytes, offset] of ROWS)
			test(`(${mode}) ${name}`, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins('admonitions');
				await editor.setPresentationMode(mode);
				await editor.loadContent(source);
				await editor.focusBlockAtPath([0, 1], 0);
				await page.keyboard.press('ArrowLeft');
				const end = source.indexOf('\n');
				expect((await editor.bridge.getSelection())?.focus).toEqual({ path: [0, 0], offset: end });

				await act(editor);

				await editor.bridge.waitForSourceEquals(bytes);
				expect((await editor.bridge.getSelection())?.focus).toEqual({ path: [0, 0], offset });
			});

	// The letter and its gap are one keystroke, so one undo takes both.
	for (const mode of ['live', 'source'] as const)
		test(`(${mode}) one undo takes the letter and its gap`, async ({ page }) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('admonitions');
			await editor.setPresentationMode(mode);
			await editor.loadContent(U);
			await editor.focusBlockAtPath([0, 1], 0);
			await page.keyboard.press('ArrowLeft');
			await page.keyboard.type('x');
			await editor.bridge.waitForSourceEquals(':::tip x\nbody\n:::\n');

			await page.keyboard.press('ControlOrMeta+z');

			await editor.bridge.waitForSourceEquals(U);
		});
});

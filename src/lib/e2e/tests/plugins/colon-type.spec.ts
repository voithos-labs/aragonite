import { test, expect } from '../../fixtures';
import { extendKey } from '../../platform-keys';
import { PluginsPage } from './helpers';

// A `:::` container a plugin value makes on `colonLines`, on a page where nothing else turns
// directives on, takes the keys an admonition on the plugins page takes, row for row
// (`requirements/plugins/colon-type.md`). The byte rules are the title-row specs'.

type Mode = 'live' | 'source';
const MODES = ['live', 'source'] as const;

/** A seed, the name its `:::` type answers to, and the kind that name reads as. */
const TYPES = [
	{ seed: 'asides', name: 'aside', kind: 'asides/aside' },
	{ seed: 'admonitions', name: 'tip', kind: 'admonition' }
] as const;

async function open(page: PluginsPage['page'], mode: Mode, seed: string, source: string) {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins(seed);
	await editor.setPresentationMode(mode);
	await editor.loadContent(source);
	return editor;
}

const kindAt = (editor: PluginsPage) =>
	editor.page.evaluate(
		() =>
			(
				window as unknown as { __test: { getDocument(): { children: { kind: string }[] } } }
			).__test.getDocument().children[0].kind
	);
const caret = async (editor: PluginsPage) => (await editor.bridge.getSelection())?.focus;

for (const type of TYPES)
	for (const mode of MODES)
		test.describe(`(${mode}) the ${type.seed} page's :::${type.name}`, () => {
			const T = `:::${type.name} T\nbody\n:::\n`;
			const U = `:::${type.name}\nbody\n:::\n`;
			const marker = `:::${type.name} `;

			test('ArrowUp from the body lands as on every `:::` row', async ({ page }) => {
				const editor = await open(page, mode, type.seed, T);
				expect(await kindAt(editor)).toBe(type.kind);
				await editor.focusBlockAtPath([0, 1], 0);
				await page.keyboard.press('ArrowUp');
				const at = mode === 'live' ? marker.length : 0;
				expect(await caret(editor)).toEqual({ path: [0, 0], offset: at });
			});

			test('a letter at a bare name’s end starts the title', async ({ page }) => {
				const editor = await open(page, mode, type.seed, U);
				await editor.focusBlockAtPath([0, 1], 0);
				await page.keyboard.press('ArrowLeft');
				await page.keyboard.type('x');
				await editor.bridge.waitForSourceEquals(`${marker}x\nbody\n:::\n`);
				expect(await caret(editor)).toEqual({ path: [0, 0], offset: marker.length + 1 });
				expect(await kindAt(editor)).toBe(type.kind);
			});

			test('Backspace at the name’s end unmakes the type, the letter back remakes it', async ({
				page
			}) => {
				const editor = await open(page, mode, type.seed, T);
				await editor.focusBlockAtPath([0, 0], `:::${type.name}`.length);
				await page.keyboard.press('Backspace');
				const shorter = `:::${type.name.slice(0, -1)} T\nbody\n:::\n`;
				await editor.bridge.waitForSourceEquals(shorter);
				expect(await kindAt(editor)).toBe('directiveContainer');
				expect(await caret(editor)).toEqual({ path: [0, 0], offset: type.name.length + 2 });
				await page.keyboard.type(type.name.slice(-1));
				await editor.bridge.waitForSourceEquals(T);
				expect(await kindAt(editor)).toBe(type.kind);
				expect(await caret(editor)).toEqual({ path: [0, 0], offset: type.name.length + 3 });
			});

			test('the marker held and removed unwraps the box', async ({ page }) => {
				const editor = await open(page, mode, type.seed, T);
				await editor.focusBlockAtPath([0, 1], 0);
				await page.keyboard.press('ArrowUp');
				if (mode === 'live') await page.keyboard.press(extendKey('lineStart'));
				else for (let i = 0; i < marker.length; i++) await page.keyboard.press('Shift+ArrowRight');
				expect(await page.evaluate(() => getSelection()?.toString())).toBe(marker);
				await page.keyboard.press('Backspace');
				await editor.bridge.waitForSourceEquals('T\n\nbody\n');
			});
		});

test.describe('a value’s two `:::` types, one name starting the other’s', () => {
	for (const mode of MODES)
		test(`(${mode}) \`s\` then \`x\` at \`:::aside\`'s end: the longer type, then its title`, async ({
			page
		}) => {
			const editor = await open(page, mode, 'asides', ':::aside\nbody\n:::\n');
			const row = page.locator('[data-block-path="[0,0]"] [contenteditable]');
			await expect(row).toHaveClass(/aside-heading/);
			await expect(row).toHaveAttribute('aria-label', 'Heading');
			await editor.focusBlockAtPath([0, 1], 0);
			await page.keyboard.press('ArrowLeft');
			await page.keyboard.type('s');
			await editor.bridge.waitForSourceEquals(':::asides\nbody\n:::\n');
			expect(await kindAt(editor)).toBe('asides/wide');
			expect(await caret(editor)).toEqual({ path: [0, 0], offset: 9 });
			await expect(row).toHaveClass(/wide-heading/);
			await expect(row).toHaveAttribute('aria-label', 'Wide heading');
			await page.keyboard.type('x');
			await editor.bridge.waitForSourceEquals(':::asides x\nbody\n:::\n');
			expect(await caret(editor)).toEqual({ path: [0, 0], offset: 11 });
		});
});

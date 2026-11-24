import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { attachIme } from '../../simulation/ime';
import { pointAtRaw } from '../../text-runs';
import { PluginsPage } from './helpers';

// A selection removed from a `:::` opening row that leaves it fewer than three colons unwraps the
// container: the title's rest, a blank line, the body, no closing line
// (`requirements/plugins/title-row-unwrap.md`). Each byte rule is `test/range-edit/opener-unwrap.test.ts`.

const T = ':::tip Title\nbody\n:::\n';
const UNWRAPPED = 'Title\n\nbody\n';
type Mode = 'live' | 'source';

const menuItem = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });

/** Holds the opening row's `:::tip ` as a user does: up from the body, then to the row's start. */
async function selectMarker(editor: PluginsPage, mode: Mode): Promise<void> {
	await editor.focusBlockAtPath([0, 1], 0);
	await editor.page.keyboard.press('ArrowUp');
	if (mode === 'live') await editor.page.keyboard.press('Shift+Home');
	else for (let i = 0; i < 7; i++) await editor.page.keyboard.press('Shift+ArrowRight');
	expect(await editor.page.evaluate(() => getSelection()?.toString())).toBe(':::tip ');
}

async function open(page: Page, mode: Mode, source = T): Promise<PluginsPage> {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins('admonitions');
	await editor.setPresentationMode(mode);
	await editor.loadContent(source);
	return editor;
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
	for (const mode of ['live', 'source'] as const) {
		for (const [name, act, bytes] of OVER_MARKER)
			test(`(${mode}) ${name} over the marker unwraps the box`, async ({ page }) => {
				const editor = await open(page, mode);
				await selectMarker(editor, mode);
				await act(editor);
				await editor.bridge.waitForSourceEquals(bytes);
			});

		test(`(${mode}) a selection made by the API, then Backspace`, async ({ page }) => {
			const editor = await open(page, mode);
			await editor.focusBlockAtPath([0, 1], 0);
			await editor.bridge.setSelection({
				anchor: { path: [0, 0], offset: 0 },
				focus: { path: [0, 0], offset: 3 }
			});
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

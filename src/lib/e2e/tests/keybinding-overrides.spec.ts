import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import type { KeybindingOverride } from '../../schema/keybinding-overrides';

async function setKeybindings(editor: EditorPage, overrides: KeybindingOverride[] | undefined) {
	await editor.page.evaluate((ov) => (window as any).__test.setKeybindings(ov), overrides);
}

const source = (editor: EditorPage) =>
	editor.page.evaluate(() => (window as any).__test.getSource() as string);

test.describe('keybinding-override prop', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('rebind: Mod+Y mapped to undo undoes the last edit', async () => {
		await editor.loadContent('hello\n');
		await setKeybindings(editor, [{ chord: 'Mod+Y', command: 'history.undo' }]);
		await editor.page.locator('.text-editable-block').first().click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type(' world');
		await expect.poll(() => source(editor)).toContain('hello world');
		await editor.page.keyboard.press('Control+y');
		await expect.poll(() => source(editor)).not.toContain('world');
	});

	test('disable: Mod+Z no longer undoes; clearing the prop restores it', async () => {
		await editor.loadContent('hello\n');
		await setKeybindings(editor, [{ chord: 'Mod+Z', command: null }]);
		await editor.page.locator('.text-editable-block').first().click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('X');
		await editor.page.keyboard.press('Control+z');
		await expect.poll(() => source(editor)).toContain('helloX');

		// Clearing the prop restores the built-in undo, proving overrides never mutated the keymap.
		await setKeybindings(editor, undefined);
		await editor.page.keyboard.press('Control+z');
		await expect.poll(() => source(editor)).not.toContain('helloX');
	});

	test('malformed chord (Ctrl+B) is dropped and does not bind bare B', async () => {
		await editor.loadContent('hello\n');
		await setKeybindings(editor, [{ chord: 'Ctrl+B', command: 'history.undo' }]);
		await editor.page.locator('.text-editable-block').first().click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('b'); // would trigger the misbound undo if 'B' were bound
		await expect.poll(() => source(editor)).toContain('hellob');
	});

	// Kind-scoped override over a TextEditableBlock leaf: resolveBinding's kind tier.
	// Mod+Alt+Y has no global binding, so it fires only where the heading override exists.
	test('per-kind scope: a heading override does not fire in a paragraph', async () => {
		await editor.loadContent('# title\n\npara\n');
		await setKeybindings(editor, [
			{ chord: 'Mod+Alt+Y', command: 'history.undo', kind: 'heading' }
		]);

		const heading = editor.page.locator('.text-editable-block', { hasText: 'title' });
		await heading.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('Z');
		await expect.poll(() => source(editor)).toContain('titleZ');
		await editor.page.keyboard.press('Control+Alt+y');
		await expect.poll(() => source(editor)).not.toContain('titleZ');

		const para = editor.page.locator('.text-editable-block', { hasText: 'para' });
		await para.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('Z');
		await expect.poll(() => source(editor)).toContain('paraZ');
		await editor.page.keyboard.press('Control+Alt+y'); // unbound here — no undo
		await editor.bridge.waitForSourceContains('paraZ');
		expect(await source(editor)).toContain('paraZ');
	});

	// Container-bubble path: the list-item leaf paragraph declines Tab, so the chord
	// bubbles to ListItemBlock.resolveKindBinding. A kind-scoped disable unbinds it.
	test('per-kind scope: disabling Tab on listItem stops the indent', async () => {
		await editor.loadContent('- one\n- two\n');
		await setKeybindings(editor, [{ chord: 'Tab', command: null, kind: 'listItem' }]);

		await editor.page.locator('.text-editable-block', { hasText: 'two' }).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');

		await editor.waitForNoSourceMutation();
		expect(await source(editor)).not.toMatch(/- one\n {2}- two/);
		expect(await source(editor)).toContain('- two');
	});

	// Global (kind-less) scope reaches the container bubble too: resolveKindBinding
	// consults override(global), so a global Tab-disable stops the list indent.
	test('global scope: disabling Tab stops the list indent at the bubble', async () => {
		await editor.loadContent('- one\n- two\n');
		await setKeybindings(editor, [{ chord: 'Tab', command: null }]);

		await editor.page.locator('.text-editable-block', { hasText: 'two' }).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');

		await editor.waitForNoSourceMutation();
		expect(await source(editor)).not.toMatch(/- one\n {2}- two/);
		expect(await source(editor)).toContain('- two');
	});
});

// Mod+Alt+U has no built-in binding, so undo fires only via the per-instance override.
// Drives every contenteditable leaf surface through its own dispatchKeyCommand call.
test.describe('override fires on every leaf dispatch surface', () => {
	const surfaces = [
		{ name: 'paragraph', content: 'para\n', focus: '.text-editable-block' },
		{ name: 'code', content: '```\ncode\n```\n', focus: '.code-block' },
		{
			name: 'table',
			content: '| a | b |\n| - | - |\n| c | d |\n',
			focus: '.table-block [contenteditable]'
		}
	];
	for (const s of surfaces) {
		test(`Mod+Alt+U undo fires in ${s.name}`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(s.content);
			await setKeybindings(editor, [{ chord: 'Mod+Alt+U', command: 'history.undo' }]);
			await editor.page.locator(s.focus).first().click();
			await editor.page.keyboard.press('End');
			await editor.page.keyboard.type('Z');
			await expect.poll(() => source(editor)).toContain('Z');
			await editor.page.keyboard.press('Control+Alt+u');
			await expect.poll(() => source(editor)).not.toContain('Z');
		});
	}
});

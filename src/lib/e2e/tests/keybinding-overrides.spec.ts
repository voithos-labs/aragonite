import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import type { KeybindingOverride } from '../../schema/keybinding-overrides';

async function setKeybindings(editor: EditorPage, overrides: KeybindingOverride[] | undefined) {
	await editor.page.evaluate((ov) => (window as any).__test.setKeybindings(ov), overrides);
}

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
		await expect.poll(() => editor.bridge.getSource()).toContain('hello world');
		await editor.page.keyboard.press('Control+y');
		await expect.poll(() => editor.bridge.getSource()).not.toContain('world');
	});

	test('disable: Mod+Z no longer undoes; clearing the prop restores it', async () => {
		await editor.loadContent('hello\n');
		await setKeybindings(editor, [{ chord: 'Mod+Z', command: null }]);
		await editor.page.locator('.text-editable-block').first().click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('X');
		await editor.page.keyboard.press('Control+z');
		await expect.poll(() => editor.bridge.getSource()).toContain('helloX');

		// Clearing the prop restores the built-in undo, proving overrides never mutated the keymap.
		await setKeybindings(editor, undefined);
		await editor.page.keyboard.press('Control+z');
		await expect.poll(() => editor.bridge.getSource()).not.toContain('helloX');
	});

	// Dropping the entry silently would leave an author guessing why their chord is inert,
	// so the parser's report is part of the contract this case pins.
	test.describe('a malformed chord', () => {
		test.use({ expectWarns: ['keybindings'] });

		test('(Ctrl+B) is dropped and does not bind bare B', async () => {
			await editor.loadContent('hello\n');
			await setKeybindings(editor, [{ chord: 'Ctrl+B', command: 'history.undo' }]);
			await editor.page.locator('.text-editable-block').first().click();
			await editor.page.keyboard.press('End');
			await editor.page.keyboard.type('b'); // would trigger the misbound undo if 'B' were bound
			await expect.poll(() => editor.bridge.getSource()).toContain('hellob');
		});
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
		await expect.poll(() => editor.bridge.getSource()).toContain('titleZ');
		await editor.page.keyboard.press('Control+Alt+y');
		await expect.poll(() => editor.bridge.getSource()).not.toContain('titleZ');

		const para = editor.page.locator('.text-editable-block', { hasText: 'para' });
		await para.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('Z');
		await expect.poll(() => editor.bridge.getSource()).toContain('paraZ');
		await editor.page.keyboard.press('Control+Alt+y'); // unbound here — no undo
		await editor.bridge.waitForSourceContains('paraZ');
		expect(await editor.bridge.getSource()).toContain('paraZ');
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
		expect(await editor.bridge.getSource()).not.toMatch(/- one\n {2}- two/);
		expect(await editor.bridge.getSource()).toContain('- two');
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
		expect(await editor.bridge.getSource()).not.toMatch(/- one\n {2}- two/);
		expect(await editor.bridge.getSource()).toContain('- two');
	});
});

// The gap caret's proxy is focused DOM of its own, so the editor root's arm declines and the
// proxy resolves the global tier itself. No leaf is focused and there is no kind scope to fall
// back on, which makes it the surface where an override-blind pre-gate is fatal rather than
// merely wrong: nothing else on the path can run the rebound command.
test.describe('override fires where no block holds focus', () => {
	test('Mod+Alt+U undo fires at the gap caret between two blocks', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('| a | b |\n| - | - |\n| c | d |\n\n```\ncode\n```\n');
		await setKeybindings(editor, [{ chord: 'Mod+Alt+U', command: 'history.undo' }]);

		await editor.page.locator('[role="cell"]').nth(3).click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('Z');
		await expect.poll(() => editor.bridge.getSource()).toContain('dZ');

		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 1 });

		await editor.page.keyboard.press('Control+Alt+u');
		await expect.poll(() => editor.bridge.getSource()).not.toContain('dZ');
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
			await expect.poll(() => editor.bridge.getSource()).toContain('Z');
			await editor.page.keyboard.press('Control+Alt+u');
			await expect.poll(() => editor.bridge.getSource()).not.toContain('Z');
		});
	}
});

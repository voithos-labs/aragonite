import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Mod+B with no selection: where the pair lands and how undo takes it back
// (`requirements/inline-editing/formatting-at-caret.md`). Which pair the toggle writes is
// pinned in `test/core/inline/format-toggle-caret.test.ts`.

test.describe('inline formatting at a collapsed caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+B inserts the pair and the next character lands inside it', async () => {
		await editor.loadContent('Hello \n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('****');

		await editor.typeSlowly('bold');
		await editor.bridge.waitForSourceContains('**bold**');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello **bold**');
	});

	test('one undo removes the inserted pair', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('****');

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('****');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello world');
	});

	// A command is not typing: the toggle breaks the keystroke batch on both sides, so the typing
	// it opened unwinds first and the pair survives that press. Pinned so a change to the
	// checkpoint machinery cannot move it silently.
	test('text typed inside the pair unwinds before the toggle does', async ({ page }) => {
		await editor.loadContent('Hello \n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('****');
		await editor.typeSlowly('bold');
		await editor.bridge.waitForSourceContains('**bold**');
		// Past the typing checkpoint's debounce, so the undo below is not racing it.
		await page.waitForTimeout(700);

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('bold');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello ****');

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('*');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello');
	});
});

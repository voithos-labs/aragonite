import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Mod+B / Mod+I with no selection (requirements/inline-editing/formatting-at-caret.md).
// The chord used to be swallowed and dropped; it now inserts the empty pair, removes
// one, or unwraps the span the caret is inside.

test.describe('inline formatting at a collapsed caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+B inserts the pair and the next character lands inside it', async () => {
		await editor.loadContent('Hello \n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('****');

		await editor.typeSlowly('bold');
		await editor.bridge.waitForSourceContains('**bold**');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello **bold**');
	});

	test('Ctrl+I inserts the single-marker pair and the next character lands inside it', async () => {
		await editor.loadContent('Hello \n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Control+i');
		await editor.bridge.waitForSourceContains('**');

		await editor.typeSlowly('em');
		await editor.bridge.waitForSourceContains('*em*');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello *em*');
	});

	test('a second Ctrl+B removes the pair it just inserted', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('Hello**** world');

		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceNotContains('****');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello world');
	});

	test('one undo removes the inserted pair', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('****');

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('****');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello world');
	});

	// The toggle joins the typing checkpoint it opened rather than standing alone —
	// the ordinary batching rule for a content edit at a caret, pinned so a change to
	// the checkpoint machinery cannot move it silently.
	test('text typed inside the pair shares the toggle undo entry', async ({ page }) => {
		await editor.loadContent('Hello \n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('****');
		await editor.typeSlowly('bold');
		await editor.bridge.waitForSourceContains('**bold**');
		// Past the typing checkpoint's debounce, so the undo below is not racing it.
		await page.waitForTimeout(700);

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('*');
		expect((await editor.bridge.getSource()).trim()).toBe('Hello');
	});

	test('Ctrl+B with the caret inside bold text removes the bold', async () => {
		await editor.loadContent('a **bold** b\n');
		await editor.focusBlock(0, 6);
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceNotContains('**');
		expect((await editor.bridge.getSource()).trim()).toBe('a bold b');
	});

	// The caret contract does NOT toggle the enclosing word — there is no
	// word-boundary rule anywhere in this editor to be consistent with.
	test('Ctrl+B mid-word inserts the pair at the caret rather than bolding the word', async () => {
		await editor.loadContent('wordy\n');
		await editor.focusBlock(0, 2);
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('****');
		expect((await editor.bridge.getSource()).trim()).toBe('wo****rdy');
	});
});

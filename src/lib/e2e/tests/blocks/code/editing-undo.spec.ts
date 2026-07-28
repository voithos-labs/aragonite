import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Undo and multi-line typing flows that cross block boundaries. Pure typing/
// Enter behavior lives in editing-typing-enter.spec.ts.

test.describe('code block editing — user interactions', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Two ArrowDowns leave the block: the closer fence is its own visual line. One press
	// used to look like an exit only because the following text landed on that line and
	// broke the fence (see editing-block-exit.spec.ts).
	test('type multi-line code then navigate out via ArrowDown', async () => {
		await editor.loadContent('```\n\n```\n\nTarget\n');
		await editor.getBlock(0).click();
		// Real keystrokes: insertText hands the browser one multi-line string, whose
		// newlines never reach the CST, so the block would hold "line 1line 2line 3".
		await editor.typeSlowly('line 1\nline 2\nline 3');
		await editor.bridge.waitForSourceContains('line 3');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('Home');
		await editor.typeText('typed below ');
		await editor.bridge.waitForSourceContains('typed below');

		expect(await editor.bridge.getSource()).toBe(
			'```\nline 1\nline 2\nline 3\n```\n\ntyped below Target\n'
		);
	});

	test('edit code then undo reverts the change', async () => {
		await editor.loadContent('```\noriginal\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.typeText(' added');
		await editor.bridge.waitForSourceContains('original added');
		await editor.undo();
		await editor.bridge.waitForSourceNotContains('original added');
		expect(await editor.bridge.getSource()).toContain('original');
	});
});

import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Pure typing/Enter behavior lives in editing-typing-enter.spec.ts.

test.describe('code block editing — user interactions', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Two ArrowDowns leave the block — the closer fence is its own visual line (see
	// editing-block-exit.spec.ts).
	test('type multi-line code then navigate out via ArrowDown', async () => {
		await editor.loadContent('```\n\n```\n\nTarget\n');
		await editor.getBlock(0).click();
		// Real keystrokes: one insertText's newlines never reach the CST ("line 1line 2line 3").
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

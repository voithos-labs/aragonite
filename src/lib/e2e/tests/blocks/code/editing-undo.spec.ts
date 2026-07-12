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

	test('type multi-line code then navigate out via ArrowDown', async () => {
		await editor.loadContent('```\n\n```\n\nTarget\n');
		await editor.getBlock(0).click();
		await editor.typeText('line 1\nline 2\nline 3');
		await editor.bridge.waitForSourceContains('line 3');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('typed below');
		await editor.bridge.waitForSourceContains('typed below');
		const source = await editor.bridge.getSource();
		expect(source).toContain('line 1');
		expect(source).toContain('line 3');
		expect(source).toContain('typed below');
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

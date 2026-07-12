import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list Backspace — nested item promote', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at start of nested item promotes it', async () => {
		await editor.loadContent('- Parent\n  - Nested\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'Nested' });
		await nested.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('- Parent\n- Nested\n');
		const source = await editor.bridge.getSource();
		expect(source).toContain('- Parent\n- Nested\n');
	});
});

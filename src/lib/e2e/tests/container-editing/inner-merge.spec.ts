import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('inner container+paragraph merge inside a blockquote', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace in trailing paragraph inside blockquote merges into deepest prose leaf of preceding nested blockquote', async () => {
		await editor.loadContent('> one\n>\n> > nested\n>\n> three\n');
		const three = editor.page.locator('[contenteditable="true"]', { hasText: /^three$/ });
		await three.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/nestedthree/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/nestedthree/);
		expect(source).toMatch(/^> one$/m);
		expect(source).not.toMatch(/^three$/m);
		expect(source).not.toMatch(/^> three$/m);
	});
});

import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('list unindent — ref alignment via registry', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+Tab promotes a nested item and focuses it', async () => {
		await editor.loadContent('- one\n  - nested a\n  - nested b\n- three\n');

		const nestedA = editor.page.locator('[contenteditable="true"]', { hasText: 'nested a' });
		await nestedA.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);

		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/- one\n.*- Xnested a\n/s);
	});

	test('Shift+Tab of the only nested item removes the nested list and focuses the promoted item', async () => {
		await editor.loadContent('- one\n  - lonely nested\n- three\n');

		const lonely = editor.page.locator('[contenteditable="true"]', { hasText: 'lonely nested' });
		await lonely.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);

		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/- one\n- Xlonely nested\n- three/);
		expect(src).not.toMatch(/- one\n  -\s*\n/);
	});
});

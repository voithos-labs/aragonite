import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('list indent — ref alignment via registry', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab-indent into an existing nested list focuses the moved item', async () => {
		await editor.loadContent('- one\n- two\n  - nested under two\n- three\n');

		const three = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await three.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);

		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const src = await editor.bridge.getSource();
		expect(src).toContain('- nested under two');
		expect(src).toContain('Xthree');
	});

	test('Tab-indent into a fresh nested list focuses the moved item', async () => {
		await editor.loadContent('- one\n- two\n- three\n');

		const two = editor.page.locator('[contenteditable="true"]', { hasText: /two$/ });
		await two.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);

		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/- one\n  - Xtwo/);
	});
});

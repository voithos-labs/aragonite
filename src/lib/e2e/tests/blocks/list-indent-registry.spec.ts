import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('list indent — ref alignment via registry', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab-indent into an existing nested list focuses the moved item', async () => {
		// Item 2 already has a nested child; Tab-indenting item 3 should
		// append it to item 2's nested list.
		await editor.loadContent('- one\n- two\n  - nested under two\n- three\n');

		const three = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await three.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);

		// Type a marker — caret should be at start of the moved item.
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const src = await editor.getSource();
		expect(src).toContain('- nested under two');
		expect(src).toContain('Xthree');
	});

	test('Tab-indent into a fresh nested list focuses the moved item', async () => {
		// Tab-indenting item 2 creates a fresh nested list under item 1
		// containing the moved item.
		await editor.loadContent('- one\n- two\n- three\n');

		const two = editor.page.locator('[contenteditable="true"]', { hasText: /^two$/ });
		await two.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);

		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const src = await editor.getSource();
		// Item 2 should now be nested under item 1 with "X" at its start.
		expect(src).toMatch(/- one\n  - Xtwo/);
	});
});

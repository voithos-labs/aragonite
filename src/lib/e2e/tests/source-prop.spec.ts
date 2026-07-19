import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('source prop change', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('clears cross-block selection when source prop changes', async ({ page }) => {
		await editor.loadContent('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n');

		await editor.focusBlockStart(0);
		await page.keyboard.down('Shift');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.up('Shift');

		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		await editor.loadContent('Totally different content.\n');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);

		await editor.focusBlockEnd(0);
		await editor.typeText(' appended');
		const src = await editor.bridge.getSource();
		expect(src).toContain('appended');
	});
});

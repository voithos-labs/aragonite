import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

test.describe('source prop change', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('clears cross-block selection when source prop changes', async ({ page }) => {
		await editor.loadContent('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n');

		// Enter cross-block mode: focus first block, then Shift+ArrowDown twice
		// to extend selection across into subsequent blocks.
		await editor.focusBlockStart(0);
		await page.keyboard.down('Shift');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.up('Shift');

		await editor.waitForCrossBlock(true);
		expect(await editor.isCrossBlockActive()).toBe(true);

		// Flip the source prop to a different document.
		await editor.loadContent('Totally different content.\n');

		// Cross-block state should be cleared.
		expect(await editor.isCrossBlockActive()).toBe(false);

		// Typing should insert visible characters — native caret is not
		// suppressed by stale data-cross-block.
		await editor.focusBlockEnd(0);
		await editor.typeText(' appended');
		const src = await editor.getSource();
		expect(src).toContain('appended');
	});
});

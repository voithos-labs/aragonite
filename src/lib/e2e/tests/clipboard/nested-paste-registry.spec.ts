import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('nested structural paste — ref alignment via registry', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste multi-block markdown inside a blockquote focuses the last inserted block', async () => {
		await editor.loadContent('> first para\n>\n> second para\n>\n> tail para\n');

		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n\ngamma\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([0, 1], 'second para'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		// Caret should land at the end of "gamma" (the last pasted block).
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const src = await editor.getSource();
		expect(src).toContain('alpha');
		expect(src).toContain('beta');
		expect(src).toContain('gammaX');
		expect(src).not.toContain('first para');
		expect(src).not.toContain('second para');
		expect(src).toContain('tail para');
	});
});

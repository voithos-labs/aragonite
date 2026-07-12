import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const PIXEL_TOLERANCE = 5;

test.describe('sticky column: preserve triggers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowDown preserves sticky column', async () => {
		await editor.loadContent(
			'First long line with text.\n\nSecond long line with text.\n\nThird long line here.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 15; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});
});

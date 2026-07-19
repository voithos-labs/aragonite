import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('geometry-based focus traversal', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowUp at top of block moves to previous block', async () => {
		await editor.loadContent('# Title\n\nParagraph text.\n');
		await editor.focusBlock(1, 0);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!# Title');
		const source = await editor.bridge.getSource();
		expect(source).toContain('!# Title');
	});

	test('ArrowDown at end of single-line block moves to next block', async () => {
		await editor.loadContent('First line.\n\nSecond line.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!Second line.');
		const source = await editor.bridge.getSource();
		expect(source).toContain('!Second line.');
	});
});

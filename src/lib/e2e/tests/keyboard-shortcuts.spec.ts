import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('prose keyboard shortcuts', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab inserts a literal tab character in a paragraph (does not focus-escape)', async () => {
		await editor.loadContent('hello\n');
		await editor.focusBlock(0, 2);
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceContains('he\tllo');
		const source = await editor.bridge.getSource();
		expect(source).toContain('he\tllo');
	});

	test('Ctrl+3 on a heading preserves cursor position relative to content', async () => {
		// The caret offset counts the new marker once: the earlier formula counted the old
		// marker's length again past the prefix.
		await editor.loadContent('## hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ControlOrMeta+3');
		await editor.bridge.waitForSourceMatches(/^### hello$/m);
		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/^### helloX$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^### helloX$/m);
	});

	test('Escape collapses a live cross-block selection', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Escape');
		await editor.waitForCrossBlock(false);
	});
});

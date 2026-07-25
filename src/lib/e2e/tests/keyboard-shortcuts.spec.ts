import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('prose keyboard shortcuts', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+Enter inserts a GFM hard break inside the paragraph', async () => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Shift+Enter');
		await editor.bridge.waitForSourceContains('hello\\');
		const source = await editor.bridge.getSource();
		expect(source).toContain('hello\\');
		expect(source).toContain('world');
	});

	test('Tab inserts a literal tab character in a paragraph (does not focus-escape)', async () => {
		await editor.loadContent('hello\n');
		await editor.focusBlock(0, 2);
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceContains('he\tllo');
		const source = await editor.bridge.getSource();
		expect(source).toContain('he\tllo');
	});

	test('Ctrl+2 converts a paragraph to an H2 heading', async () => {
		await editor.loadContent('just text\n');
		await editor.focusBlock(0, 0);
		await editor.page.keyboard.press('Control+2');
		await editor.bridge.waitForSourceMatches(/^## just text$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^## just text$/m);
	});

	test('Ctrl+3 on an already-H1 heading replaces the prefix level', async () => {
		await editor.loadContent('# old title\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Control+3');
		await editor.bridge.waitForSourceMatches(/^### old title$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^### old title$/m);
		expect(source).not.toMatch(/^# old title$/m);
	});

	test('Ctrl+0 converts a heading back to a paragraph', async () => {
		await editor.loadContent('## title\n');
		await editor.focusBlock(0, 3);
		await editor.page.keyboard.press('Control+0');
		await editor.bridge.waitForSourceMatches(/^title$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^title$/m);
		expect(source).not.toMatch(/^##/m);
	});

	test('Ctrl+3 on a heading preserves cursor position relative to content', async () => {
		// Regression: old cursor formula (level + 1 + preEditOffset) double-counted old marker length past the prefix.
		await editor.loadContent('## hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Control+3');
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

import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('inline editing — backslash escapes', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('');
		await editor.focusBlockAtPath([0], 0);
	});

	test('escape neutralizes emphasis', async () => {
		await editor.typeText('\\*foo\\*');
		await editor.bridge.waitForSourceContains('\\*foo\\*');
		expect((await editor.bridge.getSource()).trim()).toBe('\\*foo\\*');

		const block = editor.getBlock(0);
		await expect(block.locator('em')).toHaveCount(0);
		const markers = await block.locator('.md-marker').allTextContents();
		expect(markers.filter((t) => t === '\\').length).toBe(2);
	});

	test('escape neutralizes strong', async () => {
		await editor.typeText('\\**foo\\**');
		await editor.bridge.waitForSourceContains('\\**foo\\**');

		const block = editor.getBlock(0);
		await expect(block.locator('strong')).toHaveCount(0);
		const markers = await block.locator('.md-marker').allTextContents();
		expect(markers.filter((t) => t === '\\').length).toBe(2);
	});

	test('non-punctuation does not escape', async () => {
		await editor.typeText('\\a \\1');
		await editor.bridge.waitForSourceContains('\\a \\1');

		const block = editor.getBlock(0);
		const markers = await block.locator('.md-marker').allTextContents();
		expect(markers.filter((t) => t === '\\').length).toBe(0);
	});

	test('double backslash escapes the second backslash', async () => {
		// Each `\\` is one escape pair (renders as a literal `\`); the `*` chars
		// remain unescaped delimiters, so emphasis forms across `\\*foo\\*`.
		await editor.typeText('\\\\*foo\\\\*');
		await editor.bridge.waitForSourceContains('\\\\*foo\\\\*');

		const block = editor.getBlock(0);
		await expect(block.locator('em')).toHaveCount(1);
		await expect(block.locator('em')).toContainText('foo');
	});

	test('escape inside code span is inert', async () => {
		await editor.typeText('`\\*`');
		await editor.bridge.waitForSourceContains('`\\*`');

		const block = editor.getBlock(0);
		await expect(block.locator('code.inline-code-content')).toHaveCount(1);
		await expect(block.locator('code.inline-code-content')).toHaveText('\\*');
		const markers = await block.locator('.md-marker').allTextContents();
		expect(markers.filter((t) => t === '\\').length).toBe(0);
	});

	test('removing the escape backslash re-forms emphasis', async () => {
		await editor.loadContent('\\*foo*\n');
		const block = editor.getBlock(0);
		await expect(block.locator('em')).toHaveCount(0);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSourceContains('*foo*');

		await expect(block.locator('em')).toHaveCount(1);
		await expect(block.locator('em')).toHaveText('foo');
	});

	test('escape inside list item paragraph behaves identically', async () => {
		await editor.typeText('- \\*foo\\*');
		await editor.bridge.waitForSourceContains('\\*foo\\*');

		const block = editor.getBlock(0);
		await expect(block.locator('em')).toHaveCount(0);
		const markers = await block.locator('.md-marker').allTextContents();
		expect(markers.filter((t) => t === '\\').length).toBe(2);
	});

	for (const escape of ['\\*', '\\[', '\\]', '\\_', '\\`', '\\\\', '\\!', '\\#']) {
		test(`round-trips ${JSON.stringify(escape)} unchanged`, async () => {
			await editor.typeText(escape);
			await editor.bridge.waitForSourceContains(escape);
			expect((await editor.bridge.getSource()).trim()).toBe(escape);
		});
	}

	test('prepending backslash to existing *foo* collapses emphasis', async () => {
		await editor.loadContent('*foo*\n');
		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.insertText('\\');
		await editor.bridge.waitForSourceContains('\\*foo*');
		const block = editor.getBlock(0);
		expect(await block.locator('em').count()).toBe(0);
		const markers = await block.locator('.md-marker').allTextContents();
		expect(markers.filter((t) => t === '\\').length).toBe(1);
	});
});

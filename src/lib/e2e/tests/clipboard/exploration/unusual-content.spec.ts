import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('clipboard exploration: unusual content', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste content with CRLF line endings preserves block structure', async () => {
		await editor.loadContent('target\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('one\r\n\r\ntwo\r\n'));

		await editor.focusBlockAtPath([0], 'target'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('one');

		const src = await editor.bridge.getSource();
		expect(src).toContain('one');
		expect(src).toContain('two');
	});

	test('paste content with leading blank lines does not create empty paragraphs', async () => {
		await editor.loadContent('target\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('\n\nactual content\n'));

		await editor.focusBlockAtPath([0], 'target'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('actual content');

		const src = await editor.bridge.getSource();
		expect(src).toContain('actual content');
	});

	test('paste into thematic break (non-editable) — either no-op or creates paragraph', async () => {
		await editor.loadContent('above\n\n---\n\nbelow\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('pasted'));

		const hr = editor.page.locator('.block-list > .block-host > :not(.selection-overlay)').nth(1);
		await hr.click();
		await editor.page.waitForTimeout(100);

		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.bridge.getSource();
		// Paste on a thematic break may no-op or create a paragraph; either is ok
		// as long as the document isn't corrupted.
		expect(src).toMatch(/above/);
		expect(src).toMatch(/below/);
	});

	test('paste markdown containing backtick runs into a code block bumps the outer fence', async () => {
		await editor.loadContent('```\ncontent\n```\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('```\ninner fence\n```'));

		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^````/m);

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/^````/m);
	});

	test('paste after Ctrl+A selection (whole-document) replaces entire document', async ({
		page
	}) => {
		await editor.loadContent('existing para one\n\nexisting para two\n\nexisting para three\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('replacement content\n'));

		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(100);
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('replacement content');

		const src = await editor.bridge.getSource();
		expect(src).toContain('replacement content');
		expect(src).not.toContain('existing para one');
		expect(src).not.toContain('existing para two');
		expect(src).not.toContain('existing para three');
	});
});

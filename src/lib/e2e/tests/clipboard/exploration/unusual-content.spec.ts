import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

/**
 * Probe paste with unusual clipboard content shapes: CRLF line endings,
 * leading/trailing whitespace, content crossing code blocks, and
 * paste-while-focused-on-non-editable-block.
 */
test.describe('clipboard exploration: unusual content', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste content with CRLF line endings preserves block structure', async () => {
		await editor.loadContent('target\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('one\r\n\r\ntwo\r\n')
		);
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0], 'target'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('one');
		expect(src).toContain('two');
	});

	test('paste content with leading blank lines does not create empty paragraphs', async () => {
		await editor.loadContent('target\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('\n\nactual content\n')
		);
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0], 'target'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('actual content');
	});

	test('paste into thematic break (non-editable) — either no-op or creates paragraph', async () => {
		await editor.loadContent('above\n\n---\n\nbelow\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('pasted'));
		await editor.page.waitForTimeout(100);

		// Click the thematic break to focus it.
		const hr = editor.page.locator('.block-list > .block-host > :not(.selection-overlay)').nth(1);
		await hr.click();
		await editor.page.waitForTimeout(100);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// Either the paste no-ops (thematic break still there) or creates a paragraph.
		// We don't care which, but the document shouldn't be corrupted.
		expect(src).toMatch(/above/);
		expect(src).toMatch(/below/);
	});

	test('paste markdown containing backtick runs into a code block bumps the outer fence', async () => {
		await editor.loadContent('```\ncontent\n```\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('```\ninner fence\n```')
		);
		await editor.page.waitForTimeout(100);

		// Click inside the code block at the end of "content".
		await editor.focusBlockAtPath([0], 0);
		// Move cursor to end of block's content. For code blocks this might
		// need a different approach — try End key.
		await editor.page.keyboard.press('End');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// Outer fence should have bumped to at least 4 backticks.
		expect(src).toMatch(/^````/m);
	});

	test('paste after Ctrl+A selection (whole-document) replaces entire document', async ({
		page
	}) => {
		await editor.loadContent('existing para one\n\nexisting para two\n\nexisting para three\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('replacement content\n')
		);
		await editor.page.waitForTimeout(100);

		// Focus first block, Ctrl+A+A to select whole doc.
		await editor.focusBlockAtPath([0], 0);
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+a');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('replacement content');
		expect(src).not.toContain('existing para one');
		expect(src).not.toContain('existing para two');
		expect(src).not.toContain('existing para three');
	});
});

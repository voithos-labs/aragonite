import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('clipboard exploration: unusual content', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste content with CRLF line endings preserves block structure', async () => {
		await editor.loadContent('target\n');
		await editor.seedClipboard('one\r\n\r\ntwo\r\n');

		await editor.focusBlockAtPath([0], 'target'.length);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('one');

		const src = await editor.bridge.getSource();
		expect(src).toContain('one');
		expect(src).toContain('two');
	});

	// The clipboard's bytes are the answer: leading blank lines are blocks the author
	// copied, so they arrive as empty paragraphs rather than being dropped on the way in.
	test('paste content with leading blank lines keeps them as empty blocks', async () => {
		await editor.loadContent('target\n');
		await editor.seedClipboard('\n\nactual content\n');

		await editor.focusBlockAtPath([0], 'target'.length);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('actual content');

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toBe('target\n\n\n\nactual content\n');
		const pastedCount = await editor.getDomBlockCount();
		expect(pastedCount).toBe(4);

		// The run separates from `target` rather than folding into it, so the bytes reload
		// as the blocks on screen.
		await editor.loadContent(src);
		expect(await editor.getDomBlockCount()).toBe(pastedCount);
	});

	test('paste into thematic break (non-editable) — either no-op or creates paragraph', async () => {
		await editor.loadContent('above\n\n---\n\nbelow\n');
		await editor.seedClipboard('pasted');

		const hr = editor.getBlock(1);
		await hr.click();

		await editor.paste('Control+v');
		// Thematic break paste may no-op or materialize a paragraph; neither
		// outcome has a settle predicate to poll. Keep a small fixed wait so the
		// post-paste source read sees whichever branch resolved.
		await editor.page.waitForTimeout(300);

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/above/);
		expect(src).toMatch(/below/);
	});

	test('paste markdown containing backtick runs into a code block bumps the outer fence', async () => {
		await editor.loadContent('```\ncontent\n```\n');
		await editor.seedClipboard('```\ninner fence\n```');

		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('End');
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/^````/m);

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/^````/m);
	});

	test('paste after Ctrl+A selection (whole-document) replaces entire document', async ({
		page: _page
	}) => {
		await editor.loadContent('existing para one\n\nexisting para two\n\nexisting para three\n');
		await editor.seedClipboard('replacement content\n');

		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForFunction(
			() => (window.getSelection()?.toString().length ?? 0) > 0,
			null,
			{ timeout: 2000, polling: 16 }
		);
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('replacement content');

		const src = await editor.bridge.getSource();
		expect(src).toContain('replacement content');
		expect(src).not.toContain('existing para one');
		expect(src).not.toContain('existing para two');
		expect(src).not.toContain('existing para three');
	});
});

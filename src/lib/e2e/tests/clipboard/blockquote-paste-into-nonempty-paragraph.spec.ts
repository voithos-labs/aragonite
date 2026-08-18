import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('clipboard: blockquote paste into a non-empty blockquote paragraph', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('pasting a blockquote at the end of "hello" keeps "hello"', async () => {
		await editor.loadContent('> hello\n');
		await editor.seedClipboard('> world\n');

		// Caret at end of "hello" inside the blockquote's paragraph leaf [0, 0].
		await editor.focusBlockAtPath([0, 0], 'hello'.length);

		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('world');

		const src = await editor.bridge.getSource();
		// The destructive bug produced "> world\n" — "hello" gone. The fix keeps
		// the original text; default structural paste adds the pasted content.
		expect(src).toContain('hello');
		expect(src).toContain('world');
	});
});

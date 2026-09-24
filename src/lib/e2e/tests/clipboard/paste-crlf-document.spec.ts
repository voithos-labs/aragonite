import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A paste into a CRLF document writes its own lines in CRLF, whatever ending the clipboard held.
// Requirements: e2e/requirements/clipboard/paste-crlf-document.md.

test.describe('a paste into a CRLF document', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('abc\r\nAfter\r\n');
		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('End');
	});

	test('two paragraphs land with CRLF between and inside them', async () => {
		await editor.seedClipboard('x\n\ny');
		await editor.paste();
		await editor.bridge.waitForSourceContains('y');

		expect(await editor.bridge.getSource()).toBe('abc\r\n\r\nx\r\n\r\ny\r\nAfter\r\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('two lines pasted into the paragraph join it with CRLF', async () => {
		await editor.seedClipboard('x\ny');
		await editor.paste();
		await editor.bridge.waitForSourceContains('y');

		expect(await editor.bridge.getSource()).toBe('abcx\r\ny\r\nAfter\r\n');
	});
});

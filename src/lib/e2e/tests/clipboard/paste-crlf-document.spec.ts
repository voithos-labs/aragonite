import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { edgeKey } from '../../platform-keys';

// A paste into a CRLF document writes its own lines in CRLF, whatever ending the clipboard held.
// Requirements: e2e/requirements/clipboard/paste-crlf-document.md.

/** The source with `\r` and `\n` spelled out, so a diff shows a lone one. */
const escaped = (source: string) => JSON.stringify(source);

test.describe('a paste into a CRLF document', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('abc\r\nAfter\r\n');
		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
	});

	test('two paragraphs land with CRLF between and inside them', async () => {
		await editor.seedClipboard('x\n\ny');
		await editor.paste();
		await editor.bridge.waitForSourceContains('y');

		expect(escaped(await editor.bridge.getSource())).toBe(escaped('abcx\r\n\r\ny\r\nAfter\r\n'));
		expect(await editor.parseConverged()).toBe(true);
	});

	test('two lines pasted into the paragraph join it with CRLF', async () => {
		await editor.seedClipboard('x\ny');
		await editor.paste();
		await editor.bridge.waitForSourceContains('y');

		expect(escaped(await editor.bridge.getSource())).toBe(escaped('abcx\r\ny\r\nAfter\r\n'));
	});
});

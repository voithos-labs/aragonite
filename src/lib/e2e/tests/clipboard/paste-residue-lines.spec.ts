import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Windows clipboard writes CRLF, so every source read normalizes before comparing.
const asLf = (src: string) => src.replace(/\r\n/g, '\n');

test.describe('a multi-block paste keeps the lines after the caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('abc\nAfter\n');
		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('End');
	});

	test('pasting two paragraphs at a line break keeps the next line', async () => {
		await editor.seedClipboard('x\n\ny');
		await editor.paste();
		await editor.bridge.waitForSourceContains('y');

		expect(asLf(await editor.bridge.getSource())).toBe('abc\n\nx\n\ny\nAfter\n');
		expect(await editor.parseConverged()).toBe(true);

		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('yZ');
		expect(asLf(await editor.bridge.getSource())).toBe('abc\n\nx\n\nyZ\nAfter\n');
	});

	test('pasting a quote at a line break keeps the next line', async () => {
		await editor.seedClipboard('> q');
		await editor.paste();
		await editor.bridge.waitForSourceContains('> q');

		expect(asLf(await editor.bridge.getSource())).toBe('abc\n\n> q\nAfter\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('one undo gives the paragraph back', async () => {
		await editor.seedClipboard('x\n\ny');
		await editor.paste();
		await editor.bridge.waitForSourceContains('y');

		await editor.undo();
		await editor.bridge.waitForSourceEquals('abc\nAfter\n');
	});
});

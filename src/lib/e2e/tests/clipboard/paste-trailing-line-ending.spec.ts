import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { edgeKey } from '../../platform-keys';

// Windows clipboard writes CRLF, so every source read normalizes before comparing.
const asLf = (src: string) => src.replace(/\r\n/g, '\n');

test.describe('a one-line clipboard ending in a line ending', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('abc\n\nAfter\n');
		await editor.seedClipboard('x\n');
	});

	test('at the end of a paragraph leaves an empty line under it, as Enter does', async ({
		page
	}) => {
		await editor.focusBlockAtPath([0], 0);
		await page.keyboard.press(edgeKey('lineEnd'));
		await editor.paste();
		await editor.bridge.waitForSourceContains('abcx');

		expect(asLf(await editor.bridge.getSource())).toBe('abcx\n\n\nAfter\n');
		expect(await editor.parseConverged()).toBe(true);
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z');
		expect(asLf(await editor.bridge.getSource())).toBe('abcx\n\nZ\n\nAfter\n');
	});

	test('in the middle of a paragraph keeps it as a line break', async () => {
		await editor.focusBlockAtPath([0], 1);
		await editor.paste();
		await editor.bridge.waitForSourceContains('ax');

		expect(asLf(await editor.bridge.getSource())).toBe('ax\nbc\n\nAfter\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});

import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Windows clipboard writes CRLF, so every source read normalizes before comparing.
const asLf = (src: string) => src.replace(/\r\n/g, '\n');

test.describe('a multi-block paste at the start of a heading’s text', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
	});

	for (const heading of ['# Hi', '# Hi #']) {
		test(`the heading moves below the pasted blocks whole (${heading})`, async () => {
			await editor.loadContent(`${heading}\n`);
			await editor.focusBlockAtPath([0], heading.length);
			await editor.page.keyboard.press('Home');
			await editor.seedClipboard('abc\n\ndef');
			await editor.paste();
			await editor.bridge.waitForSourceContains('def');

			expect(asLf(await editor.bridge.getSource())).toBe(`abc\n\ndef\n${heading}\n`);
			expect(await editor.parseConverged()).toBe(true);
		});
	}

	test('one undo gives the heading back', async () => {
		await editor.loadContent('# Hi\n');
		await editor.focusBlockAtPath([0], 4);
		await editor.page.keyboard.press('Home');
		await editor.seedClipboard('abc\n\ndef');
		await editor.paste();
		await editor.bridge.waitForSourceContains('def');

		await editor.undo();
		await editor.bridge.waitForSourceEquals('# Hi\n');
	});
});

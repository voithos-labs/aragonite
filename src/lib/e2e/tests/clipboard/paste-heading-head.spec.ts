import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { edgeKey } from '../../platform-keys';

// Windows clipboard writes CRLF, so every source read normalizes before comparing.
const asLf = (src: string) => src.replace(/\r\n/g, '\n');

test.describe('a multi-block paste at the start of a heading’s text', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
	});

	const PASTED: Array<[heading: string, after: string]> = [
		['# Hi', '# abc\n\ndefHi\n'],
		['# Hi #', '# abc #\n\ndefHi\n']
	];
	for (const [heading, after] of PASTED) {
		test(`the first pasted block takes the heading, the text joins the last (${heading})`, async () => {
			await editor.loadContent(`${heading}\n`);
			await editor.focusBlockAtPath([0], heading.length);
			await editor.page.keyboard.press(edgeKey('lineStart'));
			await editor.seedClipboard('abc\n\ndef');
			await editor.paste();
			await editor.bridge.waitForSourceContains('def');

			expect(asLf(await editor.bridge.getSource())).toBe(after);
			expect(await editor.parseConverged()).toBe(true);
		});
	}

	test('one undo gives the heading back', async () => {
		await editor.loadContent('# Hi\n');
		await editor.focusBlockAtPath([0], 4);
		await editor.page.keyboard.press(edgeKey('lineStart'));
		await editor.seedClipboard('abc\n\ndef');
		await editor.paste();
		await editor.bridge.waitForSourceContains('def');

		await editor.undo();
		await editor.bridge.waitForSourceEquals('# Hi\n');
	});
});

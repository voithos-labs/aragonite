import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Requirements: `e2e/requirements/clipboard/paste-task-start.md`.

// Windows clipboard writes CRLF, so every source read normalizes before comparing.
const asLf = (src: string) => src.replace(/\r\n/g, '\n');

test.describe('a block pasted at the start of a to-do’s text', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a line the bare bullet reads as a divider stays the to-do’s text', async () => {
		await editor.loadContent('- [ ] bc\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.seedClipboard('---');
		await editor.paste();
		await editor.bridge.waitForSourceContains('---');

		expect(asLf(await editor.bridge.getSource())).toBe('- [ ] ---\n  bc\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('a heading takes the text’s place and the to-do gives its box up', async () => {
		await editor.loadContent('- [ ] bc\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.seedClipboard('# h');
		await editor.paste();
		await editor.bridge.waitForSourceContains('# h');

		expect(asLf(await editor.bridge.getSource())).toBe('- # h\n  bc\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});

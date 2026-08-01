import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';

test.describe('one edit event per op — blockquote splitBlock exit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// A block below the quote is load-bearing: with nothing to leave to, the exit appends
	// one, and the append is a second op rather than a second event for this one.
	test('Enter on empty trailing blockquote paragraph emits exactly one edit event', async () => {
		await editor.loadContent('> first\n>\n> \n\nafter\n');
		const before = await editor.bridge.getSource();
		const paras = editor.page.locator('.blockquote-block [contenteditable="true"]');
		await paras.last().click();
		await editor.page.keyboard.press('Home');

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceWith((s, b) => s !== b, before);
		});

		expect(count).toBe(1);
		// The empty child leaves the quote rather than the document: the quote keeps `first`
		// and the caret lands on the block below.
		expect(await editor.bridge.getSource()).toBe('> first\n\nafter\n');
	});
});

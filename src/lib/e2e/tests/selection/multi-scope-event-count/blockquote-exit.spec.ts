import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';

test.describe('one edit event per op — blockquote splitBlock exit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The block below the quote is what makes this hold: it pins that the exit is one
	// `replaceBlock` (trimmed quote plus the new blank), not a delete plus an append.
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
		// The empty child leaves the quote as a new blank between the quote and `after`: the
		// exit creates the line the caret lands on and never enters the block below. Three
		// lines, not four, because that new blank is the separating line of the block below.
		expect(await editor.bridge.getSource()).toBe('> first\n\n\nafter\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});

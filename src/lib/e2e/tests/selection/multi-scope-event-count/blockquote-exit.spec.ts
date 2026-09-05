import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';

test.describe('one edit event per op — blockquote splitBlock exit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// A block below the quote is load-bearing: it pins that the exit is one replaceBlock
	// (trimmed quote plus the minted gap), not a delete op plus an append op.
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
		// The empty child leaves the quote as a NEW blank between quote and `after`: the
		// exit mints the line the caret lands on, it never enters the block below. Three
		// lines, not four — the minted blank IS the separating line of the block below it.
		expect(await editor.bridge.getSource()).toBe('> first\n\n\nafter\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});

import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';

test.describe('one edit event per op — blockquote splitBlock exit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter on empty trailing blockquote paragraph emits exactly one edit event', async () => {
		await editor.loadContent('> first\n>\n> \n');
		const before = await editor.bridge.getSource();
		const paras = editor.page.locator('.blockquote-block [contenteditable="true"]');
		await paras.last().click();
		await editor.page.keyboard.press('Home');

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceWith((s, b) => s !== b, before);
		});

		expect(count).toBe(1);
	});
});

import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { DEFAULT_CONTENT } from '../../../test-content';
import { waitForClipboardContains } from './helpers';

test.describe('clipboard — code block boundary and direction', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DEFAULT_CONTENT);
	});

	test('select inside code block across boundary into final paragraph', async () => {
		await editor.focusBlockStart(9);
		await editor.page.keyboard.press('Control+Shift+End');

		await editor.page.keyboard.press('Control+c');
		await waitForClipboardContains(editor, 'A final paragraph');

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('const x = 42');
		expect(clip).toContain('A final paragraph');
	});

	test('bottom-to-top selection copies the block above', async () => {
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await waitForClipboardContains(editor, 'Heading 1');

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Heading 1');
		expect(clip).not.toContain('Heading 2');
	});
});

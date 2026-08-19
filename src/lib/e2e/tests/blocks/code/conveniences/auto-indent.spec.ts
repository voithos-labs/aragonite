import { test } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { expectBody, focusCodeBlockAtEnd, focusCodeBody } from './helpers';

test.describe('code block auto-indent on Enter', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of indented line copies the indent to the new line', async () => {
		await editor.loadContent('```\n\tfoo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.page.keyboard.press('Enter');
		await editor.typeText('bar');
		await expectBody(editor, '\tfoo\n\tbar');
	});

	test('Enter preserves a multi-space indent verbatim', async () => {
		await editor.loadContent('```\n    foo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.page.keyboard.press('Enter');
		await editor.typeText('bar');
		await expectBody(editor, '    foo\n    bar');
	});

	test('Enter at end of un-indented line inserts a bare newline', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.page.keyboard.press('Enter');
		await editor.typeText('bar');
		await expectBody(editor, 'foo\nbar');
	});

	test('Enter in the middle of an indented line carries the indent to the remainder', async () => {
		await editor.loadContent('```\n    foo\n```\n');
		await focusCodeBody(editor, 6);
		await editor.page.keyboard.press('Enter');
		await expectBody(editor, '    fo\n    o');
	});
});

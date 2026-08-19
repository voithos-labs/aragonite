import { test } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { expectBody, focusCodeBody } from './helpers';

test.describe('code block skip-over and pair-delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing ) when the next char is already ) skips over', async () => {
		await editor.loadContent('```\n\n```\n');
		await focusCodeBody(editor);
		await editor.typeSlowly('(');
		await editor.typeText('foo');
		await editor.typeSlowly(')');
		await expectBody(editor, '(foo)');
		await editor.typeSlowly('X');
		await expectBody(editor, '(foo)X');
	});

	test('typing " when the next char is already " skips over', async () => {
		await editor.loadContent('```\n\n```\n');
		await focusCodeBody(editor);
		await editor.typeSlowly('"');
		await editor.typeText('hi');
		await editor.typeSlowly('"');
		await expectBody(editor, '"hi"');
		await editor.typeSlowly('Y');
		await expectBody(editor, '"hi"Y');
	});

	test('Backspace between an empty pair deletes both characters', async () => {
		await editor.loadContent('```\n\n```\n');
		await focusCodeBody(editor);
		await editor.typeSlowly('(');
		await editor.page.keyboard.press('Backspace');
		await expectBody(editor, '');
	});

	test('Backspace between nested empty pairs deletes the innermost pair only', async () => {
		await editor.loadContent('```\n\n```\n');
		await focusCodeBody(editor);
		await editor.typeSlowly('(');
		await editor.typeSlowly('[');
		await editor.page.keyboard.press('Backspace');
		await expectBody(editor, '()');
	});
});

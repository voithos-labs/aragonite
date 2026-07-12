import { test } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { expectBody, focusCodeBlockAtEnd } from './helpers';

test.describe('code block conveniences — undo and highlight.js interaction', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('auto-pair undoes in one Ctrl+Z', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.typeSlowly('(');
		await expectBody(editor, 'foo()');
		await editor.undo();
		await expectBody(editor, 'foo');
	});

	test('auto-indent works inside a js-highlighted code block', async () => {
		await editor.loadContent('```js\n\tconst x = 1;\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.page.keyboard.press('Enter');
		await editor.typeText('const y = 2;');
		await expectBody(editor, '\tconst x = 1;\n\tconst y = 2;');
	});

	test('auto-close bracket works inside a js-highlighted code block', async () => {
		await editor.loadContent('```js\nfunction f\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.typeSlowly('(');
		await expectBody(editor, 'function f()');
	});
});

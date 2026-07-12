import { test } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { expectBody, focusCodeBlockAtEnd } from './helpers';

test.describe('code block auto-close brackets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing ( on an empty line inserts ( and ) with cursor between', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('(');
		await expectBody(editor, '()');
		await editor.typeSlowly('x');
		await expectBody(editor, '(x)');
	});

	test('typing [ and { also auto-pair', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('[');
		await editor.typeSlowly('{');
		await expectBody(editor, '[{}]');
	});

	test('typing ( after a word (foo|) auto-pairs', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.typeSlowly('(');
		await expectBody(editor, 'foo()');
	});

	test('typing ( before an identifier inserts only (', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('(');
		await expectBody(editor, '(foo');
	});

	test('typing ( with a selection wraps the selection', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.typeSlowly('(');
		await expectBody(editor, '(foo)');
	});
});

import { test } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { expectBody, focusCodeBlockAtEnd, focusCodeBody } from './helpers';

test.describe('code block auto-close quotes', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing " on an empty line inserts a pair', async () => {
		await editor.loadContent('```\n\n```\n');
		await focusCodeBody(editor);
		await editor.typeSlowly('"');
		await expectBody(editor, '""');
		await editor.typeText('hi');
		await expectBody(editor, '"hi"');
	});

	test("typing ' between word chars (don|t) inserts only one quote", async () => {
		await editor.loadContent('```\ndont\n```\n');
		await focusCodeBody(editor, 3);
		await editor.typeSlowly("'");
		await expectBody(editor, "don't");
	});

	test("typing ' after an identifier ('don|) closes without duplicating", async () => {
		await editor.loadContent("```\n'don\n```\n");
		await focusCodeBlockAtEnd(editor);
		await editor.typeSlowly("'");
		await expectBody(editor, "'don'");
	});

	test('typing ` auto-pairs inside a backtick-fenced code block', async () => {
		await editor.loadContent('```\n\n```\n');
		await focusCodeBody(editor);
		await editor.typeSlowly('`');
		await expectBody(editor, '``');
	});
});

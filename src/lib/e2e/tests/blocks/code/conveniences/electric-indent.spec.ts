import { test } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { expectBody } from './helpers';

test.describe('code block electric indent', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter between {|} expands into three lines with one extra indent', async () => {
		await editor.loadContent('```\nf(){}\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 8; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');
		await expectBody(editor, 'f(){\n\t\n}');
	});

	test('Enter between indented {|} preserves outer indent and adds one more inside', async () => {
		await editor.loadContent('```\n\tf(){}\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 9; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');
		await expectBody(editor, '\tf(){\n\t\t\n\t}');
	});

	test('Enter between "|" does NOT electric-indent (quotes stay inline)', async () => {
		await editor.loadContent('```\n""\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');
		await expectBody(editor, '"\n"');
	});
});

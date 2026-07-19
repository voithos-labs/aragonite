import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { DEFAULT_CONTENT } from '../../../test-content';
import { waitForClipboardContains } from './helpers';

test.describe('clipboard — container boundary scenarios', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DEFAULT_CONTENT);
	});

	test('copy last unordered + first ordered item excludes other items', async () => {
		await editor.focusBlockAtPath([7, 2, 0], 0);
		await editor.shiftClickBlock([8, 0, 0], 5);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await waitForClipboardContains(editor, 'Item three');

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Item three');
		expect(clip).toContain('First');
		expect(clip).not.toContain('Item one');
		expect(clip).not.toContain('Item two');
		expect(clip).not.toContain('Second');
	});

	test('copy from blockquote second paragraph to end collects list markers', async () => {
		await editor.focusBlockAtPath([6, 1], 0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await waitForClipboardContains(editor, 'A final paragraph');

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Second blockquote paragraph');
		expect(clip).toContain('- Item one');
		expect(clip).toContain('1. First');
		expect(clip).toContain('A final paragraph');
	});

	test('copy from ordered list last item across code block to final paragraph', async () => {
		await editor.focusBlockAtPath([8, 2, 0], 0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await waitForClipboardContains(editor, 'A final paragraph');

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Third');
		expect(clip).toContain('const x = 42');
		expect(clip).toContain('A final paragraph');
		expect(clip).not.toContain('First');
		expect(clip).not.toContain('Second');
	});
});

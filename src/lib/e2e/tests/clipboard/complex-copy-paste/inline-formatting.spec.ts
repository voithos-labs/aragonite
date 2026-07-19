import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { DEFAULT_CONTENT } from '../../../test-content';
import { waitForClipboardContains } from './helpers';

test.describe('clipboard — inline formatting preservation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DEFAULT_CONTENT);
	});

	test('copy across formatted + link paragraphs preserves all markers', async () => {
		await editor.focusBlockStart(3);
		await editor.shiftClickBlock([4], 67);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await waitForClipboardContains(editor, '**bold text**');

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('**bold text**');
		expect(clip).toContain('*italic text*');
		expect(clip).toContain('`inline code`');
		expect(clip).toContain('[link](https://example.com)');
	});

	test('copy heading through formatted paragraph preserves heading marker', async () => {
		await editor.focusBlockStart(2);
		await editor.shiftClickBlock([3], 70);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await waitForClipboardContains(editor, '### Heading 3');

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('### Heading 3');
		expect(clip).toContain('**bold text**');
	});
});

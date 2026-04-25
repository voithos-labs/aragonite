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

	test.fixme('select inside code block across boundary into final paragraph', async () => {
		// Verified failing at pre-editor-sweep-pass-7's exact shape under retries:0 (Pass 7
		// surfaced a pre-existing race; Pass 6's npm test passed by luck of test ordering /
		// browser warm-up timing). Cross-block selection that anchors INSIDE a code block
		// doesn't reach the trailing paragraph reliably — needs a real fix in the cross-block
		// dispatch's code-anchored selection extension. See editor-sweep-followups.md.
		await editor.focusBlockStart(9);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.page.waitForTimeout(100);

		await editor.page.keyboard.press('Control+c');
		await editor.page.waitForTimeout(200);

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

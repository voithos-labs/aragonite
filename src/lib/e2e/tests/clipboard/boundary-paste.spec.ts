import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { wholeBlockInput } from '../../whole-block-input';
import { edgeKey } from '../../platform-keys';

// A paste at the gap caret, or on a block focused whole, lands as the clipboard's blocks.
// Requirements: `requirements/clipboard/boundary-paste.md`.

const breakBlock = (page: Page) => page.locator('.thematic-break-block');

async function gapAboveCode(editor: EditorPage, source: string): Promise<void> {
	await editor.loadContent(source);
	await editor.page.locator('[data-block-path="[0]"] [contenteditable]').first().click();
	await editor.page.keyboard.press(edgeKey('blockStart'));
	await editor.page.keyboard.press('ArrowLeft');
	await expect.poll(() => editor.bridge.getGapCaret()).toEqual({ parentPath: [], index: 0 });
}

async function focusBreak(editor: EditorPage, source: string): Promise<void> {
	await editor.loadContent(source);
	await editor.focusBlockEnd(0);
	await editor.page.keyboard.press('ArrowDown');
	await expect(wholeBlockInput(breakBlock(editor.page))).toBeFocused();
}

test.describe('a paste at a boundary', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('at the gap caret inserts the blocks there, and one undo takes them back', async () => {
		const source = '```\ncode\n```\n\npara\n';
		await gapAboveCode(editor, source);
		await editor.clipboard.seed('# Title\n\nbody');
		await editor.clipboard.paste();
		await expect.poll(() => editor.bridge.getSource()).toBe(`# Title\n\nbody\n\n${source}`);
		await editor.page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => editor.bridge.getSource()).toBe(source);
	});

	test('on a block focused whole inserts the blocks after it', async () => {
		await focusBreak(editor, 'above\n\n---\n\nbelow\n');
		await editor.clipboard.seed('PASTED');
		await editor.clipboard.paste();
		await expect.poll(() => editor.bridge.getSource()).toBe('above\n\n---\n\nPASTED\n\nbelow\n');
	});

	test('in a CRLF document keeps its line ending', async () => {
		await focusBreak(editor, 'above\r\n\r\n---\r\n\r\nbelow\r\n');
		await editor.clipboard.seed('one\ntwo');
		await editor.clipboard.paste();
		await expect
			.poll(() => editor.bridge.getSource())
			.toBe('above\r\n\r\n---\r\n\r\none\r\ntwo\r\n\r\nbelow\r\n');
	});
});

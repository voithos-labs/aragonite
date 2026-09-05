import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: list marker preservation on copy', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered list copy preserves all item markers', async () => {
		await editor.loadContent('1. hey\n2. hey\n3. hey\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		const clipText = await editor.readClipboard();

		expect(clipText).toContain('1.');
		expect(clipText).toContain('2.');
		expect(clipText).toContain('3.');

		const heyCount = clipText.split('hey').length - 1;
		expect(heyCount).toBe(3);
	});

	test('partial last-item selection preserves list marker in clipboard', async () => {
		await editor.loadContent('1. first\n2. second\n3. third\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 2, 0], 3);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		const clip = await editor.readClipboard();

		expect(clip).toContain('1. first');
		expect(clip).toContain('2. second');
		expect(clip).toContain('3. thi');
	});
});

test.describe('cross-block clipboard: list duplication regression', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cross-block copy of a list does not duplicate nested content', async () => {
		await editor.loadContent(
			'before\n\n- Item one\n- Item two\n  - Nested item\n- Item three\n\nafter\n'
		);

		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		await editor.page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockAtPath([2], 5);

		await editor.paste();
		await editor.bridge.waitForSourceWith((s) => s.split('Item two').length - 1 === 2, null);

		const source = await editor.bridge.getSource();

		const itemTwoCount = source.split('Item two').length - 1;
		expect(itemTwoCount).toBe(2);

		const nestedCount = source.split('Nested item').length - 1;
		expect(nestedCount).toBe(2);
	});
});

test.describe('cross-block clipboard: partial list promotion regression', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('selecting last list item + content below copies only that item, not entire list', async () => {
		await editor.loadContent(
			'1. First\n2. Second\n3. Third\n\n```\ncode\n```\n\nFinal paragraph\n'
		);

		await editor.focusBlockAtPath([0, 2, 0], 0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		const clipText = await editor.readClipboard();

		expect(clipText).toContain('Third');
		expect(clipText).not.toContain('First');
		expect(clipText).not.toContain('Second');

		expect(clipText).toContain('code');
		expect(clipText).toContain('Final paragraph');
	});
});

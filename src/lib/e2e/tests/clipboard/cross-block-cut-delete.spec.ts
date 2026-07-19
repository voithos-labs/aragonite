import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: cut', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+X deletes the cross-block range', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+x');
		await editor.waitForCrossBlock(false);
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('bbb');
		expect(source).toContain('aaa');
	});

	test('Ctrl+X then undo restores original document', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+x');
		await editor.bridge.waitForSourceWith((s, b) => s !== b, before);
		expect(await editor.bridge.getSource()).not.toBe(before);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.getSource()).toBe(before);
	});
});

test.describe('cross-block clipboard: delete/backspace', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace deletes cross-block range and merges endpoints', async () => {
		await editor.loadContent('hello\n\nworld\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForCrossBlock(false);
		const source = await editor.bridge.getSource();
		expect(source).toContain('hello');
		expect(await editor.getDomBlockCount()).toBe(1);
	});

	test('Delete key deletes cross-block range', async () => {
		await editor.loadContent('abc\n\ndef\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		expect(await editor.getDomBlockCount()).toBe(1);
	});

	test('cross-block delete spanning three blocks leaves merged result', async () => {
		await editor.loadContent('AAA\n\nBBB\n\nCCC\n');
		await editor.focusBlock(0, 1);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('BBB');
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('BBB');
		expect(source).toContain('A');
	});
});

test.describe('cross-block clipboard: type-replace', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing over cross-block selection replaces it', async () => {
		await editor.loadContent('start\n\nend\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('X');
		await editor.bridge.waitForSourceContains('X');
		const source = await editor.bridge.getSource();
		expect(source).toContain('X');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	// A2/A3: cross-block typed character + range delete is a single undo unit.
	test('typing over cross-block selection then undo restores original document', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Z');
		await editor.bridge.waitForSourceContains('Z');

		const afterType = await editor.bridge.getSource();
		expect(afterType).not.toBe(before);
		expect(afterType).toContain('Z');

		await editor.page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceWith((s, b) => s.trim() === b.trim(), before);
		const afterUndo = await editor.bridge.getSource();
		expect(afterUndo.trim()).toBe(before.trim());
	});
});

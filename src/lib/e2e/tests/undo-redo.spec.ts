import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';
import { SIMPLE_CONTENT } from '../test-content';

test.describe('undo and redo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SIMPLE_CONTENT);
	});

	test('undo reverts a split (Enter then Ctrl+Z restores single block)', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		expect(await editor.bridge.getDomBlockCount()).toBeGreaterThan(3);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.bridge.getDomBlockCount()).toBe(3);
	});

	test('redo restores a split after undo', async () => {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		const splitSource = await editor.bridge.getSource();
		const splitCount = await editor.bridge.getDomBlockCount();

		await editor.undo();
		expect(await editor.bridge.getDomBlockCount()).toBe(3);

		await editor.redo();
		expect(await editor.bridge.getSource()).toBe(splitSource);
		expect(await editor.bridge.getDomBlockCount()).toBe(splitCount);
	});

	test('undo reverts typed text after debounce', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' extra words');
		await editor.page.waitForTimeout(600);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('undo reverts a merge (Backspace at start of block)', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Backspace');
		expect(await editor.bridge.getDomBlockCount()).toBeLessThan(3);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.bridge.getDomBlockCount()).toBe(3);
	});

	test('undo reverts kind change (paragraph to heading via # prefix)', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockStart(0);
		await editor.typeSlowly('# ');
		await editor.page.waitForTimeout(600);
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');

		await editor.undo();
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('multiple undo steps revert a sequence of operations', async () => {
		const original = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' appended');
		await editor.page.waitForTimeout(600);

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');

		await editor.undo();
		await editor.undo();

		expect(await editor.bridge.getSource()).toBe(original);
	});

	test('redo stack is cleared when a new edit occurs after undo', async () => {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		const splitSource = await editor.bridge.getSource();

		await editor.undo();
		await editor.focusBlockEnd(0);
		await editor.typeText('x');
		await editor.page.waitForTimeout(600);

		await editor.redo();
		expect(await editor.bridge.getSource()).not.toBe(splitSource);
	});

	test('undo on empty stack does not crash or corrupt state', async () => {
		const before = await editor.bridge.getSource();
		await editor.undo();
		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		await editor.focusBlockEnd(0);
		await editor.typeText('z');
		expect(await editor.getBlockText(0)).toContain('z');
	});
});

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

	// ── Happy paths ─────────────────────────────────────────────────────

	test('undo reverts a split (Enter then Ctrl+Z restores single block)', async () => {
		const before = await editor.getSource();
		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		expect(await editor.getDomBlockCount()).toBeGreaterThan(3);

		await editor.undo();
		expect(await editor.getSource()).toBe(before);
		expect(await editor.getDomBlockCount()).toBe(3);
	});

	test('redo restores a split after undo', async () => {
		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		const splitSource = await editor.getSource();
		const splitCount = await editor.getDomBlockCount();

		await editor.undo();
		expect(await editor.getDomBlockCount()).toBe(3);

		await editor.redo();
		expect(await editor.getSource()).toBe(splitSource);
		expect(await editor.getDomBlockCount()).toBe(splitCount);
	});

	test('undo reverts typed text after debounce', async () => {
		const before = await editor.getSource();
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' extra words');
		await editor.page.waitForTimeout(600);

		await editor.undo();
		expect(await editor.getSource()).toBe(before);
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	test('undo reverts a merge (Backspace at start of block)', async () => {
		const before = await editor.getSource();
		await editor.focusBlockStart(1);
		await editor.pressBackspace();
		expect(await editor.getDomBlockCount()).toBeLessThan(3);

		await editor.undo();
		expect(await editor.getSource()).toBe(before);
		expect(await editor.getDomBlockCount()).toBe(3);
	});

	test('undo reverts kind change (paragraph to heading via # prefix)', async () => {
		const before = await editor.getSource();
		await editor.focusBlockStart(0);
		await editor.typeSlowly('# ');
		await editor.page.waitForTimeout(600);
		expect(await editor.getBlockKind(0)).toBe('heading');

		await editor.undo();
		expect(await editor.getBlockKind(0)).toBe('paragraph');
		expect(await editor.getSource()).toBe(before);
	});

	test('multiple undo steps revert a sequence of operations', async () => {
		const original = await editor.getSource();

		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' appended');
		await editor.page.waitForTimeout(600);

		await editor.focusBlockEnd(0);
		await editor.pressEnter();

		await editor.undo();
		await editor.undo();

		expect(await editor.getSource()).toBe(original);
	});

	test('redo stack is cleared when a new edit occurs after undo', async () => {
		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		const splitSource = await editor.getSource();

		await editor.undo();
		await editor.focusBlockEnd(0);
		await editor.typeText('x');
		await editor.page.waitForTimeout(600);

		await editor.redo();
		expect(await editor.getSource()).not.toBe(splitSource);
	});

	test('undo on empty stack does not crash or corrupt state', async () => {
		const before = await editor.getSource();
		await editor.undo();
		await editor.undo();
		expect(await editor.getSource()).toBe(before);
		await editor.focusBlockEnd(0);
		await editor.typeText('z');
		expect(await editor.getBlockText(0)).toContain('z');
	});
});

import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('selection undo — cross-block restore', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// ── Happy paths ─────────────────────────────────────────────────────

	test('undo after cross-block cut restores document and cross-block selection', async () => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+x');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).not.toBe(before);

		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1]);
	});

	test('undo after cross-block backspace restores document and selection', async () => {
		await editor.loadContent('first\n\nsecond\n\nthird\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).not.toBe(before);

		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('redo after undoing a cross-block cut re-applies deletion', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+x');
		await editor.page.waitForTimeout(200);
		const afterCut = await editor.bridge.getSource();

		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe(before);

		await editor.redo();
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe(afterCut);
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	test('undo after type-replace restores selection and removes typed chars in one step', async () => {
		await editor.loadContent('hello\n\nworld\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.typeText('xyz');
		await editor.bridge.waitForSourceContains('xyz');
		const afterType = await editor.bridge.getSource();
		expect(afterType).toContain('xyz');
		expect(afterType).not.toBe(before);

		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('selection-only changes push no undo entries', async () => {
		await editor.loadContent('line1\n\nline2\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.typeText('!');
		await editor.page.waitForTimeout(600);
		const afterEdit = await editor.bridge.getSource();

		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);

		await editor.page.keyboard.press('ArrowLeft');
		await editor.waitForCrossBlock(false);

		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe(before);
	});
});

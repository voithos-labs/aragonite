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
		const before = await editor.getSource();

		// Select across blocks 0-1 via keyboard
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		// Cut
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).not.toBe(before);

		// Undo
		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toBe(before);
		expect(await editor.isCrossBlockActive()).toBe(true);

		const sel = await editor.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1]);
	});

	test('undo after cross-block backspace restores document and selection', async () => {
		await editor.loadContent('first\n\nsecond\n\nthird\n');
		const before = await editor.getSource();

		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).not.toBe(before);

		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toBe(before);
		expect(await editor.isCrossBlockActive()).toBe(true);
	});

	test('redo after undoing a cross-block cut re-applies deletion', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		const before = await editor.getSource();

		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(200);
		const afterCut = await editor.getSource();

		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toBe(before);

		await editor.redo();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toBe(afterCut);
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	test('undo after type-replace restores selection and removes typed chars in one step', async () => {
		await editor.loadContent('hello\n\nworld\n');
		const before = await editor.getSource();

		// Cross-block select from end of block 0 into block 1
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		// Type replacement text
		await editor.typeText('xyz');
		await editor.page.waitForTimeout(200);
		const afterType = await editor.getSource();
		expect(afterType).toContain('xyz');
		expect(afterType).not.toBe(before);

		// Single undo should revert all typed chars AND restore cross-block selection
		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toBe(before);
		expect(await editor.isCrossBlockActive()).toBe(true);
	});

	test('selection-only changes push no undo entries', async () => {
		await editor.loadContent('line1\n\nline2\n');
		const before = await editor.getSource();

		// Make a change so the undo stack has something
		await editor.focusBlockEnd(0);
		await editor.typeText('!');
		await editor.page.waitForTimeout(600);
		const afterEdit = await editor.getSource();

		// Now do selection-only operations (no mutation)
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);

		// Collapse
		await editor.pressKey('ArrowLeft');
		await editor.waitForCrossBlock(false);

		// Undo should revert the typed "!" — selection changes shouldn't
		// have pushed extra entries
		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toBe(before);
	});
});

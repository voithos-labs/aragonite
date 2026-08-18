import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('selection — keyboard: shift+arrow contraction (D1)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowLeft contracts a forward single-block selection without crossing block boundary', async () => {
		// Contraction, not extension: reading the RANGE START rather than the focus treats a
		// forward selection's focus as already at 0 and fires cross-block extension.
		await editor.loadContent('Hello world\n\nbelow\n');
		await editor.focusBlock(0, 0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Shift+ArrowLeft');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('Hell');
	});

	test('Shift+ArrowRight contracts a backward single-block selection without crossing block boundary', async () => {
		// The backward twin: focus sits at the block start, which a focus-unaware path mistakes
		// for a boundary and sends into `extendFocusToPreviousBlock`.
		await editor.loadContent('above\n\nHello world\n');
		await editor.focusBlock(1, 5);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowLeft');
		await editor.page.keyboard.press('Shift+ArrowRight');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('ello');
	});

	// Post-entry contraction: once a cross-block selection exists, walking the
	// focus back into the anchor block must collapse to a native single-block
	// range — not persist an invisible same-path cross-block state (E-F1).
	test('contracting a cross-block selection back into the anchor block restores the native range', async () => {
		await editor.loadContent('Hello world\n\nsecond\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(false);

		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('Hello world');
	});

	test('contracting after a backward cross-block entry restores the range from the true anchor', async () => {
		// Composes E-F2 (backward anchor capture at offset 6) with the collapse
		// restore. If the anchor were mis-captured at 0, the restore would be empty.
		await editor.loadContent('first\n\nHello world\n');
		await editor.focusBlock(1, 6);
		for (let i = 0; i < 6; i++) await editor.page.keyboard.press('Shift+ArrowLeft');
		await editor.page.keyboard.press('Shift+ArrowLeft'); // cross the block boundary
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Shift+ArrowRight'); // contract back into block 1
		await editor.waitForCrossBlock(false);

		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('Hello ');
	});

	test('copy after contracting into the anchor block yields the single-block range', async () => {
		await editor.loadContent('Hello world\n\ntarget\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(false);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		await editor.clickBlock(1);
		await editor.page.keyboard.press('End');
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('targetHello world');
		expect(await editor.bridge.getSource()).toContain('targetHello world');
	});
});

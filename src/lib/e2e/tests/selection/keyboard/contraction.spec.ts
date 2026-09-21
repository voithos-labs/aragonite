import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('selection: keyboard: shift+arrow contraction (D1)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowLeft contracts a forward single-block selection without crossing block boundary', async () => {
		// Shrinking, not extending: reading the range's start rather than the focus treats a
		// forward selection's focus as already at 0 and fires a cross-block extension.
		await editor.loadContent('Hello world\n\nbelow\n');
		await editor.focusBlock(0, 0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Shift+ArrowLeft');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('Hell');
	});

	test('Shift+ArrowRight contracts a backward single-block selection without crossing block boundary', async () => {
		// The backward counterpart: focus sits at the block start, which a path that ignores the
		// focus mistakes for a boundary and sends into `extendFocusToPreviousBlock`.
		await editor.loadContent('above\n\nHello world\n');
		await editor.focusBlock(1, 5);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowLeft');
		await editor.page.keyboard.press('Shift+ArrowRight');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('ello');
	});

	// Shrinking after entry: once a cross-block selection exists, stepping the focus back into
	// the anchor block must collapse to a native single-block range, rather than keeping an
	// invisible cross-block state whose two paths are the same.
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
		// Combines capturing a backward anchor at offset 6 with the restore on collapse. If
		// the anchor were captured at 0 instead, the restored range would be empty.
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

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();
		await editor.clickBlock(1);
		await editor.page.keyboard.press('End');
		await editor.paste();
		await editor.bridge.waitForSourceContains('targetHello world');
	});
});

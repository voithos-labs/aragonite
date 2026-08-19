import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('selection — keyboard: backward-selection cross-block entry (E-F2)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// A backward native selection (anchor after focus) puts the focus at the
	// range start; capturing range.start as the cross-block anchor grabs the wrong
	// end and drops the highlighted span. Entry must capture the true anchor.
	test('captures the real anchor when entering cross-block from a backward selection', async () => {
		await editor.loadContent('first\n\nHello world\n');
		await editor.focusBlock(1, 5);
		// Backward-select "Hello" (anchor stays at 5, focus walks 5→0).
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowLeft');
		// One more Shift+ArrowLeft crosses the block boundary into cross-block mode.
		await editor.page.keyboard.press('Shift+ArrowLeft');
		await editor.waitForCrossBlock(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel?.anchor).toEqual({ path: [1], offset: 5 });
	});

	test('Backspace deletes the highlighted range, not a shifted one', async () => {
		await editor.loadContent('first\n\nHello world\n');
		await editor.focusBlock(1, 5);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowLeft');
		await editor.page.keyboard.press('Shift+ArrowLeft');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('first world');

		expect(await editor.bridge.getSource()).not.toContain('Hello');
	});
});

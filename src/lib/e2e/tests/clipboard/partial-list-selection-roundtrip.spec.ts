import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('copy-paste round-trip: partial-list selection preserves structure', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('mid-one to end-of-three (offset 5): exact round-trip', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 2, 0], 5);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		await editor.page.keyboard.press('Control+v');
		// The round-trip's end state IS its start state, so no source predicate can
		// observe the paste. The selection collapsing is the one real transition.
		await editor.waitForCrossBlock(false);

		const src = await editor.bridge.getSource();
		expect(src.trim()).toBe('1. one\n2. two\n3. three');
	});

	test('mid-one to mid-three (offset 4): residue reattaches, full round-trip', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 2, 0], 4);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		await editor.page.keyboard.press('Control+v');
		await editor.waitForCrossBlock(false);

		const src = await editor.bridge.getSource();
		expect(src.trim()).toBe('1. one\n2. two\n3. three');
	});

	test('mid-one to end-of-two (two-item partial): exact round-trip', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 1, 0], 3);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		await editor.page.keyboard.press('Control+v');
		await editor.waitForCrossBlock(false);

		const src = await editor.bridge.getSource();
		expect(src.trim()).toBe('1. one\n2. two\n3. three');
	});
});

import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

/**
 * Partial-selection Ctrl+C → Ctrl+V inside an ordered list reconstructs
 * the original structure. Two cooperating changes make this possible:
 *
 * - `collectCrossBlockText` now prefixes the start block's container
 *   marker on mid-item selections (symmetric to the end-side helper), so
 *   the clipboard parses as a list instead of a paragraph with bare
 *   "2." / "3." continuation lines (CommonMark §5.2 otherwise folds them).
 *
 * - `pasteDispatch` handles the non-empty-target container-matching case
 *   by merging the first clipboard item's content into the target leaf at
 *   the caret and splicing the remaining items as siblings. Trailing
 *   residue from the pre-paste delete reattaches to the last spliced
 *   item.
 */
test.describe('copy-paste round-trip: partial-list selection preserves structure', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('mid-one to end-of-three (offset 5): exact round-trip', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		// Selection: offset 1 of "one" ("o|ne") through offset 5 of "three" (end).
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 2, 0], 5);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src.trim()).toBe('1. one\n2. two\n3. three');
	});

	test('mid-one to mid-three (offset 4): residue reattaches, full round-trip', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		// Selection: offset 1 of "one" ("o|ne") through offset 4 of "three" ("thre|e").
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 2, 0], 4);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// The trailing "e" (post-"thre") reattaches to the last item so the
		// document returns to its original shape.
		expect(src.trim()).toBe('1. one\n2. two\n3. three');
	});

	test('mid-one to end-of-two (two-item partial): exact round-trip', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 1, 0], 3);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src.trim()).toBe('1. one\n2. two\n3. three');
	});
});

import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

/**
 * Copy-paste round-trip fidelity in lists. When the user copies list
 * items and pastes them back into a list, the items should flatten
 * into the outer list — not nest as a sub-list inside the target item.
 * This is the classic markdown-editor "list round-trip" expectation
 * (Obsidian, Typora, VS Code markdown all behave this way).
 *
 * The failing behavior before the fix: pasting "1. one\n2. two\n"
 * into an empty list item produces a list-item containing a nested
 * list, resulting in "1. 1. one\n   2. two\n" instead of a flat list.
 */
test.describe('copy-paste round-trip: container-matching list paste flattens', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('3-item list, select items 1-2, Ctrl+C+V → original structure', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// Expected: round-trip preserves the original 3-item structure.
		expect(src.trim()).toBe('1. one\n2. two\n3. three');
	});

	test('2-item list, select all, Ctrl+C+V → original structure', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// Expected: round-trip preserves the original flat 2-item structure.
		expect(src.trim()).toBe('1. one\n2. two');
	});

	test('unordered list round-trip (select 1-2, copy-paste)', async () => {
		await editor.loadContent('- alpha\n- beta\n- gamma\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'beta'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src.trim()).toBe('- alpha\n- beta\n- gamma');
	});

	test('pasting external list content (pre-staged clipboard) into a list also flattens', async () => {
		await editor.loadContent('- target one\n- target two\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('- pasted a\n- pasted b\n'));
		await editor.page.waitForTimeout(100);

		// Cross-block select entire target list.
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'target two'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// Normalize line endings — Windows `navigator.clipboard.writeText`
		// stores with CRLF even when called with LF, which is an OS-level
		// artifact unrelated to this test's concern (structural
		// flattening).
		const normalized = src.replace(/\r\n/g, '\n').trim();
		expect(normalized).toBe('- pasted a\n- pasted b');
	});
});

import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

/**
 * User-reported follow-up to the 0.5.2 consolidation: partial-selection
 * copy-paste within a list (mid-word to mid-word) used to produce a
 * nested-list mess. The root cause was our parser treating "2." as
 * interrupting an open paragraph (only "1." may per CommonMark §5.2);
 * the clipboard "ne\n2. two\n3. thre" parsed as [paragraph, list]
 * instead of a single paragraph, routing through the structural paste
 * path and splitting the target item into four children.
 *
 * With the CommonMark conformance fix, the clipboard now parses as a
 * single paragraph. The inline paste splices the text into the target's
 * raw, producing a single list item with multi-line content. Not
 * the full 3-item round-trip the user might wish for (inherent
 * limitation of plain-text clipboard for mid-word partial selections),
 * but clean and structurally correct.
 */
test.describe('partial-selection list copy-paste produces clean (non-nested) output', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('mid-one to mid-three partial selection, Ctrl+C+V: no nested list, no content loss', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		// Selection: offset 1 of "one" ("o|ne") to offset 4 of "three" ("thre|e")
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 2, 0], 4);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();

		// Full original content survives (no silent deletion).
		expect(src).toContain('one');
		expect(src).toContain('two');
		expect(src).toContain('three');

		// No nested-list artifacts: no 5+ space indentation inside a list item
		// (5 spaces is "1. " marker width 3 + 2-space nest indent).
		expect(src).not.toMatch(/^\s{5,}/m);
	});
});

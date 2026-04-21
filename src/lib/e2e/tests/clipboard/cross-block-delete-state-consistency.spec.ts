/**
 * Regression test for the 0.5.5.3 cross-block-delete desync bug.
 *
 * Before the commitMultiScope rework, performCrossBlockDelete used a
 * commitStructural with a proxy-doc trick. When rangeDelete descended into
 * a nested container and spliced its children directly, only top-level
 * blockIds / blockRefs were resynced — the nested container's registered
 * BlockListState still held ids/refs shaped to the pre-delete children
 * array. The keyed {#each} then keyed components against stale ids,
 * producing zombie components and other rendering weirdness (Bug A class).
 *
 * This test asserts the invariant violated by that bug:
 *
 *   For every container in the live CST, if it has a registered
 *   BlockListState, then:
 *     node.children.length
 *   === state.innerBlockIds.length
 *   === state.innerBlockRefs.length
 *
 * The scenarios exercise deletes that touch nested containers at different
 * depths — any desync reported by the audit helper fails the test.
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

type StateViolation = {
	path: number[];
	kind: string;
	childrenLen: number;
	idsLen: number;
	refsLen: number;
};

async function auditState(editor: EditorPage): Promise<StateViolation[]> {
	return editor.page.evaluate(
		() => ((window as any).__test.auditBlockListStateConsistency() ?? []) as StateViolation[]
	);
}

test.describe('cross-block delete — BlockListState consistency (0.5.5.3 regression guard)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('delete spanning a blockquote leaves its BlockListState in sync', async () => {
		// Structure:
		//   [0] paragraph "alpha"
		//   [1] blockquote with two inner paragraphs
		//   [2] paragraph "omega"
		// Select from mid-[0] to mid-[1]'s first inner paragraph — a cross-container
		// delete whose LCA is the doc root AND which reaches into the blockquote.
		await editor.loadContent('alpha\n\n> quote line 1\n> quote line 2\n\nomega\n');

		await editor.focusBlock(0, 2); // "al|pha"
		// Shift+click deep inside blockquote's first inner paragraph.
		await editor.shiftClickBlock([1, 0], 5);
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete spanning list items leaves the enclosing list BlockListState in sync', async () => {
		// Three-item list. Delete from mid-item-1 paragraph to mid-item-3 paragraph.
		// The enclosing list's children array shrinks from 3 to 1 (merged);
		// pre-fix, the list's innerBlockIds still had 3 entries, desynced.
		// The touched containers at different levels:
		//   - list @ [0]
		//   - list-item @ [0, 0] (ancestor of start)
		//   - list-item @ [0, 2] (ancestor of end; may be cascade-removed)
		await editor.loadContent('- first\n- second\n- third\n');

		await editor.focusBlockAtPath([0, 0, 0], 2); // "fi|rst"
		await editor.shiftClickBlock([0, 2, 0], 3); // "thi|rd"
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete across a list and a paragraph leaves all nested state in sync', async () => {
		// Mixed top-level + container: start inside a list item's paragraph,
		// end in the following top-level paragraph. Doc LCA, top-level splice,
		// list's BlockListState AND list-item's BlockListState need resyncing.
		await editor.loadContent('- alpha\n- beta\n\nfollow\n');

		await editor.focusBlockAtPath([0, 0, 0], 1); // "a|lpha"
		await editor.shiftClickBlock([1], 3); // "fol|low"
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete spanning nested list leaves both list levels in sync', async () => {
		// Outer list with a nested sub-list. Delete reaches into the nested
		// list — tests that deeply-nested BlockListState instances also get
		// resynced, not just the immediate parent.
		// Path [0, 1, 1, 1, 0] = outer[0] → item[1] → (paragraph[0], nested-list[1]) → item[1] → paragraph[0].
		await editor.loadContent('- outer first\n- outer second\n  - nested 1\n  - nested 2\n');

		await editor.focusBlockAtPath([0, 0, 0], 3); // "out|er first"
		await editor.shiftClickBlock([0, 1, 1, 1, 0], 3); // "nes|ted 2"
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(250);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});
});

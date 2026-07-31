// The BlockListState consistency invariant: for every registered container,
// `children.length === innerBlockIds.length === innerBlockRefs.length`.
import { test, expect } from '../../fixtures';
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

test.describe('cross-block delete — BlockListState consistency', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('delete spanning a blockquote leaves its BlockListState in sync', async () => {
		await editor.loadContent('alpha\n\n> quote line 1\n> quote line 2\n\nomega\n');

		await editor.focusBlock(0, 2);
		await editor.shiftClickBlock([1, 0], 5);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForCrossBlock(false);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete spanning list items leaves the enclosing list BlockListState in sync', async () => {
		await editor.loadContent('- first\n- second\n- third\n');

		await editor.focusBlockAtPath([0, 0, 0], 2);
		await editor.shiftClickBlock([0, 2, 0], 3);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForCrossBlock(false);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete across a list and a paragraph leaves all nested state in sync', async () => {
		await editor.loadContent('- alpha\n- beta\n\nfollow\n');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([1], 3);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForCrossBlock(false);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete spanning nested list leaves both list levels in sync', async () => {
		await editor.loadContent('- outer first\n- outer second\n  - nested 1\n  - nested 2\n');

		await editor.focusBlockAtPath([0, 0, 0], 3);
		await editor.shiftClickBlock([0, 1, 1, 1, 0], 3);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForCrossBlock(false);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete from a paragraph into a table body cell leaves the row state in sync', async () => {
		await editor.loadContent('alpha\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');

		// Shift+click into body cell (row 1, col 0): the whole-row snap removes
		// rows 0–1 and promotes "3|4" — the table's own row BlockListState must
		// shrink with its children.
		await editor.focusBlock(0, 2);
		const cell = editor.page.locator('[role="cell"]').nth(2);
		const box = await cell.boundingBox();
		if (!box) throw new Error('body cell has no bounding box');
		await editor.page.keyboard.down('Shift');
		await editor.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await editor.page.keyboard.up('Shift');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForCrossBlock(false);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});
});

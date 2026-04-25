// Asserts the BlockListState consistency invariant: for every container with a
// registered BlockListState, node.children.length === innerBlockIds.length ===
// innerBlockRefs.length. Scenarios exercise deletes touching nested containers
// at different depths.
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
		await editor.page.waitForTimeout(200);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete spanning list items leaves the enclosing list BlockListState in sync', async () => {
		await editor.loadContent('- first\n- second\n- third\n');

		await editor.focusBlockAtPath([0, 0, 0], 2);
		await editor.shiftClickBlock([0, 2, 0], 3);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(200);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete across a list and a paragraph leaves all nested state in sync', async () => {
		await editor.loadContent('- alpha\n- beta\n\nfollow\n');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([1], 3);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(200);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});

	test('delete spanning nested list leaves both list levels in sync', async () => {
		await editor.loadContent('- outer first\n- outer second\n  - nested 1\n  - nested 2\n');

		await editor.focusBlockAtPath([0, 0, 0], 3);
		await editor.shiftClickBlock([0, 1, 1, 1, 0], 3);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(250);

		const violations = await auditState(editor);
		expect(violations).toEqual([]);
	});
});

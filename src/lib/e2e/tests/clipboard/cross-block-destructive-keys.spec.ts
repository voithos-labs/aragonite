// A1 regression guard: cross-block selection + Enter / Shift+Enter / Tab /
// Ctrl+B / Ctrl+0..6 must delete the range first, then dispatch the key's
// block-level behavior at the collapsed caret. Before the fix, these keys
// fell through to the originating block's onKeyDown, which applied the op
// to one single-block raw while the cross-block selection visually persisted.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block destructive-key dispatch (A1)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter collapses cross-block selection and splits at the merge point', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Enter');
		await editor.waitForCrossBlock(false);

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const source = await editor.bridge.getSource();
		// Merge concatenates "al" + "ta"; Enter splits it after "al".
		expect(source).toMatch(/al\s*\n\s*ta/);
	});

	test('Shift+Enter collapses cross-block and inserts a hard line break', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Shift+Enter');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('al\\');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const source = await editor.bridge.getSource();
		expect(source).toContain('al\\');
	});

	test('Ctrl+B collapses cross-block (no stale selection over shifted indices)', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+b');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceNotContains('pha');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const source = await editor.bridge.getSource();
		// Range deleted ("pha" and "be" removed), merged to "al" + "ta".
		expect(source).not.toContain('pha');
		expect(source).not.toContain('be');
	});

	test('Ctrl+2 collapses cross-block and converts merged block to H2', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+2');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('## ');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
		const source = await editor.bridge.getSource();
		expect(source).toContain('## ');
	});

	test('Ctrl+0 collapses cross-block and strips heading prefix from merge target', async () => {
		await editor.loadContent('# alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 4);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+0');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceNotContains('# ');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
	});

	test('Tab in a plain paragraph selection collapses cross-block and inserts a literal tab', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Tab');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('\t');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const source = await editor.bridge.getSource();
		expect(source).toContain('\t');
	});

	// A command key whose cross-block selection STARTS in a table must reach the
	// table cell's runCommand, not the TableBlock wrapper. The dispatcher reveals
	// the delete's own post-delete caret (a deep [table,row,col] cell), so the
	// command lands; the old code revealed selection.start.path ([tableIdx]) and
	// the command was silently dropped after the destructive delete.
	test('Enter with a table-start cross-block selection reaches the cell, not the wrapper', async ({
		page
	}) => {
		await editor.loadContent(
			'| h1 | h2 | h3 |\n| --- | --- | --- |\n| aaa | bbb | ccc |\n| ddd | eee | fff |\n\nAfter.\n'
		);
		// Drag from body cell "bbb" (mid-row, mid-col) out to the paragraph below so
		// the table is the start endpoint of the cross-block range.
		const from = page.locator('[role="cell"]').nth(4);
		const to = page.getByText('After.');
		const fromBox = await from.boundingBox();
		const toBox = await to.boundingBox();
		if (!fromBox || !toBox) throw new Error('missing bounding box');
		const sx = fromBox.x + fromBox.width / 2;
		const sy = fromBox.y + fromBox.height / 2;
		const ex = toBox.x + toBox.width / 2;
		const ey = toBox.y + toBox.height / 2;
		await page.mouse.move(sx, sy);
		await page.mouse.down();
		for (let i = 1; i <= 12; i++) {
			const t = i / 12;
			await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
		}
		await page.mouse.up();
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('Enter');
		await editor.waitForCrossBlock(false);
		// The delete wipes the covered body rows, then the cell's Enter command
		// inserts an empty body row below the caret — the observable proof the
		// command reached the cell's runCommand. A command dropped at the table
		// wrapper would leave only the header row, no empty body row.
		await editor.bridge.waitForSourceContains('| --- | --- | --- |\n|  |  |  |');

		// The caret lands in the new cell: the next keystroke writes into the grid,
		// and the table stays well-formed.
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('| Z |');
		const source = await editor.bridge.getSource();
		expect(source).toContain('| h1 | h2 | h3 |');
	});
});

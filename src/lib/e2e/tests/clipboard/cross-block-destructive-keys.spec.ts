// A key over a cross-block selection must DELETE the range first, then dispatch its
// block-level behavior at the collapsed caret. Falling through to the originating block's
// onKeyDown applies the op to one raw while the selection visually persists. The format
// toggles are the exception: they mark each block span in place rather than type-replace the
// range, and the selection survives (#107).
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

	// A format toggle is NOT one of these keys: it marks each block's own span instead of
	// deleting the range (#107 — the delete-then-dispatch arm turned the document into `****`).
	// The selection survives, which is also what keeps it off shifted indices.
	test('Ctrl+B marks each endpoint span and the range survives', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+b');
		// The anchor block's tail and the focus block's head, each marked on its own — no delete.
		await editor.bridge.waitForSourceEquals('al**pha**\n\n**be**ta\n', 3000);

		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('Ctrl+2 collapses cross-block and converts merged block to H2', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+2');
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

		await editor.page.keyboard.press('ControlOrMeta+0');
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

	// A selection STARTING in a table must reach the cell's runCommand, not the TableBlock
	// wrapper: the dispatcher reveals the delete's own post-delete caret (a deep cell path),
	// where revealing `selection.start.path` drops the command after the destructive delete.
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
		// The inserted empty body row is the observable proof the command reached the cell: a
		// command dropped at the table wrapper leaves only the header row.
		await editor.bridge.waitForSourceContains('| --- | --- | --- |\n|  |  |  |');

		// The caret lands in the new cell: the next keystroke writes into the grid,
		// and the table stays well-formed.
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('| Z |');
		const source = await editor.bridge.getSource();
		expect(source).toContain('| h1 | h2 | h3 |');
	});
});

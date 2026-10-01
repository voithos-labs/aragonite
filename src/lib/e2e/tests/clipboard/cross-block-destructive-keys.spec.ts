// A key over a cross-block selection must delete the range first, then run its block-level
// behavior at the collapsed caret, not fall through to the originating block's `onKeyDown`.
// The format toggles are the exception: they mark each block's span in place and the selection
// survives.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { dragBetweenCells } from '../blocks/table/helpers';

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

	// A format toggle marks each block's own span instead of deleting the range, since deleting first
	// would leave `****`; the selection survives, which also keeps it off shifted indices.
	test('Ctrl+B marks each endpoint span and the range survives', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+b');
		// The anchor block's tail and the focus block's head, each marked on its own, no delete.
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

	// A selection starting in a table must reach the cell's `runCommand`, not the `TableBlock`
	// wrapper: the target is resolved from the caret the delete leaves, a deep cell path.
	test('Enter with a table-start cross-block selection reaches the cell, not the wrapper', async ({
		page
	}) => {
		await editor.loadContent(
			'| h1 | h2 | h3 |\n| --- | --- | --- |\n| aaa | bbb | ccc |\n| ddd | eee | fff |\n\nAfter.\n'
		);
		// Drag from body cell "bbb" (mid-row, mid-col) out to the paragraph below so
		// the table is the start endpoint of the cross-block range.
		const from = page.locator('.table-cell').nth(4);
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

// Miss-analysis: every command-key row here drew prose or a range leaving a table, so no test
// pressed a command key over a whole table, row or column, where it cleared the cells instead.
test.describe('a command key over a whole table, row or column', () => {
	const SOURCE =
		'lead\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\ntail\n';
	// Cells count row by row from the header: 0-2 the header, 3-5 the first body row.
	const COVERAGES: [string, (editor: EditorPage) => Promise<void>][] = [
		['a whole row', (editor) => dragBetweenCells(editor.page, 3, 5)],
		['a whole column', (editor) => dragBetweenCells(editor.page, 1, 7)],
		['a whole table', (editor) => dragBetweenCells(editor.page, 0, 8)]
	];

	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
	});

	// A fresh page each time: loading the source the editor was last given changes nothing.
	async function pressOver(select: (editor: EditorPage) => Promise<void>, keys: string[]) {
		await editor.goto();
		await editor.loadContent(SOURCE);
		await select(editor);
		await editor.waitForCrossBlock(true);
		for (const key of keys) await editor.page.keyboard.press(key);
		await editor.waitForCrossBlock(false);
		await editor.waitForRenderFlush();
		return editor.bridge.getSource();
	}

	for (const key of ['Enter', 'Tab', 'ControlOrMeta+2']) {
		for (const [coverage, select] of COVERAGES) {
			test(`${key} over ${coverage} ends as Backspace then ${key}, one undo`, async () => {
				const expected = await pressOver(select, ['Backspace', key]);

				await pressOver(select, [key]);
				await expect.poll(() => editor.bridge.getSource()).toBe(expected);

				await editor.undo();
				await expect.poll(() => editor.bridge.getSource()).toBe(SOURCE);
			});
		}
	}
});

// Miss-analysis: every range here fit on one screen, so no test saw a key that writes in place
// leave its caret where a long removal had scrolled away from.
test.describe('a command key over a range longer than the screen', () => {
	const LONG = Array.from({ length: 160 }, (_, i) => `p${i}`).join('\n\n') + '\n';

	for (const key of ['Tab', 'Shift+Enter']) {
		test(`${key} leaves the caret's block in view`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(LONG);
			await editor.focusBlockAtPath([0], 1);
			for (let i = 0; i < 70; i++) await page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);

			await page.keyboard.press(key);
			await editor.waitForCrossBlock(false);

			await expect
				.poll(() =>
					page.evaluate(() => {
						const box = document.activeElement?.getBoundingClientRect();
						return !!box && box.top >= 0 && box.bottom <= window.innerHeight;
					})
				)
				.toBe(true);
		});
	}
});

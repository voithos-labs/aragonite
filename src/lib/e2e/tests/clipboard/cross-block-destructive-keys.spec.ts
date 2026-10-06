// A key over a cross-block selection must delete the range first, then run its block-level
// behavior at the collapsed caret, not fall through to the originating block's `onKeyDown`.
// The format toggles and Tab are the exceptions: neither deletes, and the selection survives.
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

	// Tab over a selection indents list items and code lines, and two paragraphs hold neither.
	test('Tab over a plain paragraph selection deletes nothing and keeps the range', async () => {
		await editor.loadContent('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.pressDeclined('Tab');

		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		expect(await editor.bridge.getSource()).toBe('alpha\n\nbeta\n');
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

	// The caret a row or column removal leaves is a cell, which binds no Mod+2, so that key is no
	// command key there; Enter is the cell's own, and past a whole table the caret is in prose.
	const COMMAND_KEYS: [string, (typeof COVERAGES)[number][]][] = [
		['Enter', COVERAGES],
		['ControlOrMeta+2', COVERAGES.slice(2)]
	];

	for (const [key, coverages] of COMMAND_KEYS) {
		for (const [coverage, select] of coverages) {
			test(`${key} over ${coverage} ends as Backspace then ${key}, one undo`, async () => {
				const expected = await pressOver(select, ['Backspace', key]);

				await pressOver(select, [key]);
				await expect.poll(() => editor.bridge.getSource()).toBe(expected);

				await editor.undo();
				await expect.poll(() => editor.bridge.getSource()).toBe(SOURCE);
			});
		}
	}

	for (const [coverage, select] of COVERAGES.slice(0, 2)) {
		test(`ControlOrMeta+2 over ${coverage} changes nothing`, async () => {
			await editor.goto();
			await editor.loadContent(SOURCE);
			await select(editor);
			await editor.waitForCrossBlock(true);

			await editor.pressDeclined('ControlOrMeta+2');

			expect(await editor.bridge.getSource()).toBe(SOURCE);
			expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		});
	}

	// A table holds nothing Tab indents, so Tab over it is not a delete.
	for (const [coverage, select] of COVERAGES) {
		test(`Tab over ${coverage} changes nothing`, async () => {
			await editor.goto();
			await editor.loadContent(SOURCE);
			await select(editor);
			await editor.waitForCrossBlock(true);

			await editor.pressDeclined('Tab');

			expect(await editor.bridge.getSource()).toBe(SOURCE);
		});
	}
});

// Miss-analysis: no row took blocks whole between neighbours of different kinds, so nothing held
// the block a command key is claimed by to the one its removal lands in.
test('Enter over two rules held whole splits the heading before them', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('# head\n\n---\n\n---\n\nbeta\n');
	// Set, not dragged: a rule has no caret position for a drag to stop on.
	await editor.bridge.setSelection({
		anchor: { path: [1], offset: 0 },
		focus: { path: [2], offset: 3 }
	});
	await editor.waitForCrossBlock(true);

	await page.keyboard.press('Enter');

	await editor.bridge.waitForSourceEquals('# head\n\n\nbeta\n', 3000);
});

// Miss-analysis: every range here fit on one screen, so no test saw a key that writes in place
// leave its caret where a long removal had scrolled away from.
test.describe('a command key over a range longer than the screen', () => {
	const LONG = Array.from({ length: 160 }, (_, i) => `para number ${i}`).join('\n\n') + '\n';
	// What each key writes in place at the caret, so the check waits on the key's own write.
	const WRITES = [['Shift+Enter', 'para\\']] as const;

	for (const [key, written] of WRITES) {
		test(`${key} leaves the caret's block in view`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(LONG);
			await editor.focusBlockAtPath([0], 4);
			for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);
			// The extend's own scroll, done before the key: the caret's block is still rendered, but
			// off screen. A block outside the render window comes back into view as it mounts.
			await expect
				.poll(() =>
					page.evaluate(() => {
						const box = document.querySelector(`[data-block-path='[0]']`)?.getBoundingClientRect();
						return !!box && box.bottom < 0;
					})
				)
				.toBe(true);

			await page.keyboard.press(key);
			await editor.waitForCrossBlock(false);
			await editor.bridge.waitForSourceContains(written);
			await editor.waitForRenderFlush();
			await editor.waitForRenderFlush();

			// Read once: a later scroll from elsewhere must not stand in for the landing.
			const [top, bottom, height] = await page.evaluate(() => {
				const box = document.activeElement?.getBoundingClientRect();
				return [box?.top ?? NaN, box?.bottom ?? NaN, window.innerHeight];
			});
			expect(top >= 0 && bottom <= height, `block at ${top}..${bottom} of ${height}`).toBe(true);
		});
	}
});

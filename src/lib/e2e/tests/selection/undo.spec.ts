import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('selection undo — cross-block restore', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// ── Happy paths ─────────────────────────────────────────────────────

	test('undo after cross-block cut restores document and cross-block selection', async () => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceWith((s, b) => s !== b, before);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1]);
	});

	test('undo after cross-block backspace restores document and selection', async () => {
		await editor.loadContent('first\n\nsecond\n\nthird\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceWith((s, b) => s !== b, before);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('redo after undoing a cross-block cut re-applies deletion', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceWith((s, b) => s !== b, before);
		const afterCut = await editor.bridge.getSource();

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);

		await editor.redo();
		await editor.bridge.waitForSourceEquals(afterCut);
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	test('undo after type-replace restores selection and removes typed chars in one step', async () => {
		await editor.loadContent('hello\n\nworld\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.typeText('xyz');
		await editor.bridge.waitForSourceContains('xyz');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('selection-only changes push no undo entries', async () => {
		await editor.loadContent('line1\n\nline2\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('line1!');

		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Shift+ArrowDown');

		await editor.page.keyboard.press('ArrowLeft');
		await editor.waitForCrossBlock(false);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});

	// Regression: post-undo blockRefs alignment for moved components.
	test('post-undo blockRefs realign — table column drag selects cells, not the next paragraph', async ({
		page
	}) => {
		// Use a minimal showcase-shaped fixture: paragraph-paragraph cross-block
		// delete + a table downstream.
		const fixture = [
			'one\n',
			'two\n',
			'three\n',
			'four\n',
			'',
			'| A | B |',
			'| - | - |',
			'| 1 | 2 |',
			'| 3 | 4 |',
			'',
			'tail\n'
		].join('\n');
		await editor.loadContent(fixture);
		const before = await editor.bridge.getSource();

		// Cross-block select paragraph[1]→paragraph[2], delete, undo.
		await editor.focusBlockEnd(1);
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.waitForCrossBlock(false);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);

		// Drag down through the first column of the table.
		const tableInfo = await page.evaluate(() => {
			const tableEl = document.querySelector('[role="table"]') as HTMLElement | null;
			if (!tableEl) return null;
			tableEl.scrollIntoView({ block: 'center' });
			const firstCell = tableEl.querySelector('.table-cell') as HTMLElement | null;
			const rows = tableEl.querySelectorAll('[data-table-row-idx]');
			const lastRow = rows[rows.length - 1] as HTMLElement;
			const lastFirstCell = lastRow?.querySelector('.table-cell') as HTMLElement | null;
			const r = firstCell?.getBoundingClientRect();
			const r2 = lastFirstCell?.getBoundingClientRect();
			return r && r2
				? {
						startX: r.x + 30,
						startY: r.y + r.height / 2,
						endY: r2.y + r2.height / 2
					}
				: null;
		});
		expect(tableInfo).not.toBeNull();

		await page.mouse.move(tableInfo!.startX, tableInfo!.startY);
		await page.mouse.down();
		await page.mouse.move(tableInfo!.startX, tableInfo!.endY, { steps: 15 });
		await page.waitForFunction(
			() => {
				const s = (window as any).__test?.getSelectionPaths?.();
				return s && s.focus.offset > 0;
			},
			null,
			{ timeout: 2000, polling: 16 }
		);

		const sel = await editor.bridge.getSelectionPaths();
		await page.mouse.up();

		// Intra-table selection: anchor.path === focus.path with cell-index
		// offsets, not a cross-block jump into the next paragraph.
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual(sel!.focus.path);
		expect(sel!.anchor.offset).toBe(0);
		expect(sel!.focus.offset).toBeGreaterThan(0);
	});
});

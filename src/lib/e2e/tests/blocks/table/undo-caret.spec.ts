import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const TABLE_FIXTURE = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

test.describe('table block: caret/selection recovery on undo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_FIXTURE);
	});

	test('undo after Alt+Shift+Backspace restores caret to same cell', async ({ page }) => {
		// Focus cell at row 2, col 1 (body row 2, middle column = "5" cell).
		await page.locator('[role="cell"]').nth(7).click();

		const before = await editor.bridge.getSource();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| A | C |');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);

		await page.keyboard.type('Z');
		const after = await editor.bridge.getSource();
		// Caret must land in the "5" cell (row 2, col 1); the click leaves it on either
		// side of the text, so the regex accepts "Z5" or "5Z".
		expect(after).toContain('| 4 |');
		expect(after).toMatch(/\| [Z5]{2} \|/);
		expect(after).toContain('| 6 |');
	});

	test('undo after Ctrl+Shift+Backspace (delete row) restores caret to same cell', async ({
		page
	}) => {
		// Focus cell row 1 col 1 (the "2" cell — picking row 1 not row 2 since
		// row deletion test should pick a row that wouldn't promote header).
		await page.locator('[role="cell"]').nth(4).click();

		const before = await editor.bridge.getSource();
		await page.keyboard.press('ControlOrMeta+Shift+Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 | 3 |');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);

		await page.keyboard.type('Z');
		const after = await editor.bridge.getSource();
		// Caret must land in "2" cell. Result: "| 1 | Z2 | 3 |" or "| 1 | 2Z | 3 |".
		expect(after).toContain('| 1 |');
		expect(after).toMatch(/\| [Z2]{2} \|/);
		expect(after).toContain('| 3 |');
	});

	test('undo after typing in a cell restores caret to that cell', async ({ page }) => {
		// Cell index 4 = body row 0, col 1 (middle of 3×3 — the "2" cell).
		await page.locator('[role="cell"]').nth(4).click();
		await page.keyboard.press('End');

		const before = await editor.bridge.getSource();

		await editor.typeSlowly('xy');
		await editor.bridge.waitForSourceContains('| 1 | 2xy | 3 |');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);

		await page.keyboard.type('Z');
		const after = await editor.bridge.getSource();
		expect(after).toContain('| 1 |');
		expect(after).toContain('| 3 |');
		expect(after).toMatch(/\| [Z2]{2} \|/);
	});

	test('undo after deleting a substring inside a cell restores caret to that cell', async ({
		page
	}) => {
		// Multi-char middle cell so substring delete is meaningful (the user repro).
		await editor.loadContent(
			'| A | Column | C |\n| --- | --- | --- |\n| 1 | Column | 3 |\n| 4 | data | 6 |\n'
		);
		await page.locator('[role="cell"]').nth(4).click();
		await page.keyboard.press('End');

		const before = await editor.bridge.getSource();

		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('| 1 | Col | 3 |');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);

		await page.keyboard.type('Z');
		const after = await editor.bridge.getSource();
		expect(after).toContain('| 1 |');
		expect(after).toContain('| 3 |');
		expect(after).toMatch(/\| [A-Za-z]*Z[A-Za-z]* \| 3 \|/);
		expect(after).not.toMatch(/\| Z[^|]*\| Column/);
	});

	test('undo after column delete via cross-block coverage restores selection', async ({ page }) => {
		// Drag down column 0 (header "A" → body cell "4") to make a column-covering selection — the
		// 3-stage Ctrl+A escalates cell → table → document without ever isolating a column.
		const tableInfo = await page.evaluate(() => {
			const tableEl = document.querySelector('[role="table"]') as HTMLElement;
			tableEl.scrollIntoView({ block: 'center' });
			const cells = Array.from(tableEl.querySelectorAll('.table-cell')) as HTMLElement[];
			const r1 = cells[0].getBoundingClientRect();
			const r2 = cells[6].getBoundingClientRect();
			return {
				startX: r1.x + r1.width / 2,
				startY: r1.y + r1.height / 2,
				endX: r2.x + r2.width / 2,
				endY: r2.y + r2.height / 2
			};
		});

		await page.mouse.move(tableInfo.startX, tableInfo.startY);
		await page.mouse.down();
		await page.mouse.move(tableInfo.endX, tableInfo.endY, { steps: 15 });
		await editor.waitForCrossBlock(true);
		await page.mouse.up();

		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		const before = await editor.bridge.getSource();
		await page.keyboard.press('Backspace');
		// Settle on column A's disappearance: '| A | B | C |' contains '| B | C |',
		// so waiting for the post-delete header would return before the Backspace ran.
		await editor.bridge.waitForSourceNotContains('| A |');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);

		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual(sel!.focus.path);
	});
});

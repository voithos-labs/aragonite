import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';
import { capturePageErrors } from '../../../page-probes';

const TABLE_2x2 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
const TABLE_3ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_3COL = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';

test.describe('table block: keyboard vocabulary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_2x2);
	});

	test('Ctrl+Enter inserts a new row below and focuses its first cell', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Control+Enter');
		await editor.bridge.waitForSourceContains('| 1 | 2 |\n|  |  |\n');
		await expect(page.locator('[role="cell"]')).toHaveCount(6);
		await expect(page.locator('[role="cell"]').nth(4)).toBeFocused();
	});

	test('Ctrl+Shift+Enter inserts a new row above and focuses its first cell', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Control+Shift+Enter');
		await editor.bridge.waitForSourceContains('| --- | --- |\n|  |  |\n| 1 | 2 |\n');
		await expect(page.locator('[role="cell"]').nth(2)).toBeFocused();
	});

	test('Alt+Shift+ArrowRight inserts a column to the right and focuses the new cell', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+ArrowRight');
		await editor.bridge.waitForSourceContains('| A |  | B |');
		await editor.bridge.waitForSourceContains('| --- | --- | --- |');
		await expect(page.locator('[role="cell"]').nth(1)).toBeFocused();
	});

	test('Alt+Shift+ArrowLeft inserts a column to the left', async ({ page }) => {
		await page.locator('[role="cell"]').nth(1).click();
		await page.keyboard.press('Alt+Shift+ArrowLeft');
		await editor.bridge.waitForSourceContains('| A |  | B |');
		await editor.bridge.waitForSourceContains('| --- | --- | --- |');
	});

	test('Ctrl+Shift+Backspace deletes a body row when ≥2 body rows remain', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Control+Shift+Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		await editor.bridge.waitForSourceContains('| 3 | 4 |');
	});

	test('Alt+Shift+Backspace deletes the current column when ≥2 columns remain', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(1).click();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| A | C |');
		await editor.bridge.waitForSourceNotContains(' B ');
	});

	test('Ctrl+Shift+A from none jumps to center, then cycles left/center/right without revisiting none', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(0).click();

		await page.keyboard.press('Control+Shift+A');
		await editor.bridge.waitForSourceContains('| :---: | --- |');

		await page.keyboard.press('Control+Shift+A');
		await editor.bridge.waitForSourceContains('| ---: | --- |');

		await page.keyboard.press('Control+Shift+A');
		await editor.bridge.waitForSourceContains('| :--- | --- |');

		await page.keyboard.press('Control+Shift+A');
		await editor.bridge.waitForSourceContains('| :---: | --- |');
	});

	test('Ctrl+Shift+Backspace is a no-op when only one body row remains', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Control+Shift+Backspace');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Alt+Shift+Backspace is a no-op when only one column remains', async ({ page }) => {
		await editor.loadContent('| A |\n| --- |\n| 1 |\n');
		await page.locator('[role="cell"]').nth(0).click();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Deleting the header row promotes the next row to be the new header', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Control+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| 1 | 2 |\n| --- | --- |\n| 3 | 4 |\n');
		await editor.bridge.waitForSourceNotContains('| A | B |');
	});

	test('Shortcut mutations are single-undo-entry (Ctrl+Z restores prior state)', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Control+Enter');
		await editor.bridge.waitForSourceContains('|  |  |');
		await editor.undo();
		await editor.bridge.waitForSourceNotContains('|  |  |');
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Shift+Enter inside a cell inserts a literal <br> at the cursor', async ({ page }) => {
		// Inline raw-HTML parsing makes <br> a recognized rawHtml node, so a cell can
		// carry it without confusing it with markup. This pins the byte-level
		// insertion; the rendered widget is cell-line-break.spec.ts.
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | 2 |\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await editor.bridge.waitForSourceContains('hello<br>');
		expect(await editor.bridge.getSource()).toContain('| hello<br> | 2 |');
	});

	test('Delete-column then undo restores live alignments (not just source)', async ({ page }) => {
		await editor.loadContent(
			'| A | B | C | D |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n'
		);

		const captureCellAligns = async () =>
			page.evaluate(() =>
				Array.from(document.querySelectorAll('[role="cell"]')).map(
					(c) => window.getComputedStyle(c as HTMLElement).textAlign
				)
			);

		const before = await editor.bridge.getSource();
		const stylesBefore = await captureCellAligns();

		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| B | C | D |');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| A | B | C | D |');

		expect(await editor.bridge.getSource()).toBe(before);
		expect(await captureCellAligns()).toEqual(stylesBefore);
	});

	test('Column ops still work after a delete-column + undo (state-registry stays current)', async ({
		page
	}) => {
		// Undo deep-clones the tree, swapping every container node's identity.
		// The state-registry (keyed by node identity) must follow, otherwise
		// commitMultiScope's per-row scope lookup throws and column ops silently no-op.
		await editor.loadContent(
			'| A | B | C | D |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n'
		);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| B | C | D |');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| A | B | C | D |');

		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| B | C | D |');

		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+ArrowRight');
		await editor.bridge.waitForSourceContains('| B |  | C | D |');
	});

	test('Delete-undo-delete-undo cycles cleanly without state desync', async ({ page }) => {
		// childIds live on container nodes; cloneNode clones them with the doc, so
		// every undo restores the per-row id arrays alongside `children`. Without
		// that, the second undo would leave row.childIds shorter than row.children
		// and Svelte's keyed each would log `each_key_duplicate` for `undefined` keys.
		// Also catches state_unsafe_mutation regressions: the focusout handler in
		// TableBlock writes to internalStickyColumn / focusedCell during reconcile.
		const pageErrors = capturePageErrors(page);
		const original = '| A | B | C | D |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n';
		await editor.loadContent(original);

		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| B | C | D |');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| A | B | C | D |');

		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| B | C | D |');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| A | B | C | D |');

		expect(await editor.bridge.getSource()).toBe(original);

		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});

test.describe('table block: delete-last-row / delete-last-column focus landing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Regression: deleteRow read a stale pre-commit row count and clamped the
	// post-delete focus against `oldCount - 1`. Deleting the LAST body row then
	// targeted a row index that no longer exists, so focus landed on nothing.
	// Reading the post-commit count via `deps.node` (and clamping to it) keeps
	// focus on a surviving cell.
	test('deleting the last body row lands focus on a surviving cell', async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		await editor.loadContent(TABLE_3ROW);

		// Header + 2 body rows = 6 cells. Focus a cell in the LAST body row
		// (row index 2 → cell index 4). Body-count is 2, so delete is not a no-op.
		await page.locator('[role="cell"]').nth(4).click();
		await expect(page.locator('[role="cell"]').nth(4)).toBeFocused();

		await page.keyboard.press('Control+Shift+Backspace');
		await editor.bridge.waitForSourceNotContains('| 3 | 4 |');
		await expect(page.locator('[role="cell"]')).toHaveCount(4);

		// Focus must survive on an existing cell. The stale-count bug targeted the
		// now-removed last row, leaving focus on <body> → :focus count 0.
		await expect(page.locator('[role="cell"]:focus')).toHaveCount(1);
		expect(pageErrors).toEqual([]);
	});

	// Symmetric regression for deleteColumn: it read a stale pre-commit column
	// count and clamped focus against the old width, targeting the deleted last
	// column's index.
	test('deleting the last column lands focus on a surviving cell', async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		// 2-column table so delete is not a no-op (no-op fires at 1 column).
		await editor.loadContent(TABLE_2x2);

		// Focus a body cell in the LAST column (row 1, col 1 → cell index 3).
		await page.locator('[role="cell"]').nth(3).click();
		await expect(page.locator('[role="cell"]').nth(3)).toBeFocused();

		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| A |');
		await editor.bridge.waitForSourceNotContains(' B ');
		await expect(page.locator('[role="cell"]')).toHaveCount(2);

		await expect(page.locator('[role="cell"]:focus')).toHaveCount(1);
		expect(pageErrors).toEqual([]);
	});
});

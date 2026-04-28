import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

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
		// No mutation expected; allow a short window for any (unwanted) commit to land.
		await page.waitForTimeout(150);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Alt+Shift+Backspace is a no-op when only one column remains', async ({ page }) => {
		await editor.loadContent('| A |\n| --- |\n| 1 |\n');
		await page.locator('[role="cell"]').nth(0).click();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Alt+Shift+Backspace');
		await page.waitForTimeout(150);
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

	test('Shift+Enter inside a cell is a silent no-op (deferred until inline-HTML rendering)', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| hello | 2 |\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Shift+Enter');
		await page.waitForTimeout(150);
		expect(await editor.bridge.getSource()).toBe(before);
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
		const pageErrors: string[] = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));
		const original =
			'| A | B | C | D |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n';
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

		// Live children-vs-childIds parity is what each_key_duplicate would have caught.
		const parity = await page.evaluate(() => {
			const doc = (window as any).__test.getDocument?.();
			const t = doc?.children?.[0];
			return (t?.children ?? []).map((row: any) => ({
				cells: row.children?.length ?? 0,
				ids: row.childIds?.length ?? 0
			}));
		});
		for (const { cells, ids } of parity) expect(ids).toBe(cells);
		expect(pageErrors).toEqual([]);
	});
});

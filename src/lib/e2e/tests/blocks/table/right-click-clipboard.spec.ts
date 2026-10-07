import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { dragBetweenCells } from './helpers';
import { holdClipboardRead, releaseClipboardRead } from '../../../page-probes';

// Cells render row-major: 0=A 1=B (header) · 2="hello" 3="world" (body row).
const TABLE = '| A | B |\n| --- | --- |\n| hello | world |\n';

test.describe('table block: cell right-click clipboard', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.seedClipboard('');
		await editor.loadContent(TABLE);
	});

	// The clipboard trio is the cell menu's own top-level group; the axis flyouts carry only
	// inserts and moves (`test/blocks/table/table-menu-model.test.ts`).
	test('the cell menu shows Cut/Copy/Paste at the top level, not inside the axis flyouts', async ({
		page
	}) => {
		await page.locator('.table-cell').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /^cut$/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /^copy$/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /^paste$/i })).toBeVisible();

		const flyout = page.locator('.table-action-menu-flyout');
		for (const group of ['Row', 'Column'] as const) {
			await page.getByRole('menuitem', { name: group, exact: true }).hover();
			await expect(flyout).toBeVisible();
			await expect(flyout.getByRole('menuitem', { name: /^(cut|copy|paste)$/i })).toHaveCount(0);
		}
	});

	test('Copy writes the cell selection to the clipboard', async ({ page }) => {
		const cell = page.locator('.table-cell').nth(2); // "hello"
		await cell.click();
		await page.keyboard.press('ControlOrMeta+a');
		await cell.click({ button: 'right' }); // right-click inside the selection
		await page.getByRole('menuitem', { name: /^copy$/i }).click();
		await expect.poll(() => editor.readClipboard()).toBe('hello');
		// Copy is non-destructive.
		expect(await editor.bridge.getSource()).toContain('| hello | world |');
	});

	test('Cut removes the selection from the cell and writes it to the clipboard', async ({
		page
	}) => {
		const cell = page.locator('.table-cell').nth(2); // "hello"
		await cell.click();
		await page.keyboard.press('ControlOrMeta+a');
		await cell.click({ button: 'right' });
		await page.getByRole('menuitem', { name: /^cut$/i }).click();
		await expect.poll(() => editor.readClipboard()).toBe('hello');
		await editor.bridge.waitForSourceContains('|  | world |');
		await editor.bridge.waitForSourceNotContains('hello');
	});

	test('Cut is a single undo entry', async ({ page }) => {
		const before = await editor.bridge.getSource();
		const cell = page.locator('.table-cell').nth(2);
		await cell.click();
		await page.keyboard.press('ControlOrMeta+a');
		await cell.click({ button: 'right' });
		await page.getByRole('menuitem', { name: /^cut$/i }).click();
		await editor.bridge.waitForSourceNotContains('hello');

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Cut and Copy are disabled with a collapsed caret; Paste stays enabled', async ({
		page
	}) => {
		const cell = page.locator('.table-cell').nth(2);
		await cell.click(); // collapsed caret, no selection
		await cell.click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /^cut$/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /^copy$/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /^paste$/i })).toBeEnabled();
	});

	test('Paste inserts clipboard text at the caret', async ({ page }) => {
		// Empty target cell: the caret is at offset 0 wherever the right-click lands,
		// so the paste position is deterministic (a right-click repositions the caret).
		await editor.loadContent('| A | B |\n| --- | --- |\n|  | world |\n');
		await editor.seedClipboard('pasted');
		await page.locator('.table-cell').nth(2).click({ button: 'right' }); // empty body cell
		await page.getByRole('menuitem', { name: /^paste$/i }).click();
		await editor.bridge.waitForSourceContains('| pasted | world |');

		// The cell keeps focus after paste, so typing continues at the caret (native).
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('| pastedZ | world |');
	});

	// A rectangle inside the table suppresses the cell's native selection, so a menu that reads
	// `hasSelection` greys out the very Cut and Copy the rectangle is for.
	test('Cut/Copy enable for an intra-table rectangle and Copy writes it', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		// Drag a 2×2 body rectangle: cell 2 (row1,col0="1") → cell 5 (row2,col1="4").
		await dragBetweenCells(page, 2, 5);
		await editor.waitForCrossBlock(true);

		// Right-click a rectangle cell preserves the rect (button-2 pointerdown no-ops).
		await page.locator('.table-cell').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /^cut$/i })).toBeEnabled();
		await expect(page.getByRole('menuitem', { name: /^copy$/i })).toBeEnabled();

		await page.getByRole('menuitem', { name: /^copy$/i }).click();
		const copied = await editor.readClipboard();
		expect(copied).toContain('1');
		expect(copied).toContain('4');
		// Copy is non-destructive.
		expect(await editor.bridge.getSource()).toContain('| 1 | 2 |');
	});

	test('Paste over a selection replaces the selected text', async ({ page }) => {
		await editor.seedClipboard('bye');
		const cell = page.locator('.table-cell').nth(2); // "hello"
		await cell.click();
		await page.keyboard.press('ControlOrMeta+a');
		await cell.click({ button: 'right' });
		await page.getByRole('menuitem', { name: /^paste$/i }).click();
		await editor.bridge.waitForSourceContains('| bye | world |');
	});
});

// The cell menu's Paste waits on the clipboard read, and the cell it was picked in can be gone by
// the time the text arrives: the paste then lands nowhere rather than in the next document.
test.describe('table block: cell menu paste across a source swap', () => {
	test('lands nowhere', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
		await holdClipboardRead(page);
		await page.locator('.table-cell').nth(2).click({ button: 'right' });
		await page.getByRole('menuitem', { name: /^paste$/i }).click();

		const next = '| C | D |\n| --- | --- |\n| other | cells |\n';
		await page.evaluate((md) => (window as any).__test.setSource(md), next);
		await editor.bridge.waitForSourceEquals(next);
		await releaseClipboardRead(page, 'CLIP');
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe(next);
	});
});

// Miss-analysis: the menu's Paste was only ever picked at a caret or a selection inside one cell,
// so nothing saw it write into the clicked cell beside a live range.
test.describe('table block: cell menu Paste over a live range', () => {
	const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
	const RANGES: [string, (editor: EditorPage) => Promise<void>][] = [
		['a cell rectangle', (editor) => dragBetweenCells(editor.page, 2, 5)],
		[
			'a whole table',
			async (editor) => {
				await editor.page.locator('.table-cell').nth(2).click();
				await editor.page.keyboard.press('ControlOrMeta+a');
				await editor.page.keyboard.press('ControlOrMeta+a');
			}
		]
	];

	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
	});

	// A fresh page each time: loading the source the editor was last given changes nothing.
	async function selectOver(select: (editor: EditorPage) => Promise<void>): Promise<void> {
		await editor.goto();
		await editor.seedClipboard('P');
		await editor.loadContent(GRID);
		await select(editor);
		await editor.waitForCrossBlock(true);
	}

	for (const [name, select] of RANGES) {
		test(`over ${name} it ends as Ctrl+V does, the range gone`, async ({ page }) => {
			await selectOver(select);
			await page.keyboard.press('ControlOrMeta+v');
			await editor.waitForCrossBlock(false);
			await editor.waitForRenderFlush();
			const pasted = await editor.bridge.getSource();
			expect(pasted).not.toBe(GRID);

			await selectOver(select);
			await page.locator('.table-cell').nth(3).click({ button: 'right' });
			await page.getByRole('menuitem', { name: /^paste$/i }).click();

			await editor.bridge.waitForSourceEquals(pasted);
			await editor.waitForCrossBlock(false);
		});
	}
});

import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { extendKey } from '../../platform-keys';

// A range edit whose far end sits in a table the window has unmounted: the table commits by its
// ids, and no state its unmounted component left behind is found or read.
// Requirements: e2e/requirements/selection/range-edit-unmounted-container.md.

const PARAGRAPHS = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}.`);
const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
const TABLE_INDEX = PARAGRAPHS.length;

test.describe('range edit reaching an unmounted table', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent([...PARAGRAPHS, TABLE].join('\n\n'));
	});

	test.afterEach(async ({ page }) => {
		const violations = await page.evaluate(() =>
			(window as any).__test.auditBlockListStateConsistency()
		);
		expect(violations).toEqual([]);
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('Shift+Mod+End from paragraph 3, then Delete and typing', async ({ page }) => {
		await editor.focusBlock(2, 'Paragraph 2'.length);
		await page.keyboard.press(extendKey('docEnd'));
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('Paragraph 0.\n\nParagraph 1.\n\nParagraph 2x');
	});

	test('Shift+Mod+Home from a table cell, so the table unmounts, then Delete and typing', async ({
		page
	}) => {
		await editor.scrollEditorTo(1e7);
		await editor.clickBlockAtPath([TABLE_INDEX, 1, 0], 1);
		await page.keyboard.press(extendKey('docStart'));
		await editor.waitForCrossBlock(true);
		await expect(page.locator('.table-block'), 'the table has left the window').toHaveCount(0);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await page.keyboard.type('x');
		// What the same gesture writes over a three-block document, where the table stays mounted:
		// the emptied first paragraph keeps its line, and the table its header.
		await editor.bridge.waitForSourceEquals('x\n\n| a | b |\n| --- | --- |\n| 3 | 4 |');
	});
});

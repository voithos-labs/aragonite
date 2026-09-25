import { test, expect } from '../../../fixtures';
import { revealWidget, roundTripStable } from '../../plugins/helpers';
import { CellMathPage } from './helpers';

/**
 * Showing an inline `$…$` formula's source to edit it, inside a table cell
 * (`requirements/blocks/table/cell-inline-reveal.md`). A cell runs the same `widgetInteraction`
 * and caret-edge dispatch as a prose block, so clicking a cell's math shows its source, Enter or
 * blur commits, Escape cancels. Only in a cell: a `|` typed into a shown formula is escaped on
 * commit, so it can never split the row on reparse.
 */

const SEED = '| Formula | Note |\n| --- | --- |\n| $x^2$ | ok |\n\nAfter\n';

test.describe('table cell: inline math reveal-to-edit', () => {
	let editor: CellMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new CellMathPage(page);
		await editor.gotoMathTable();
	});

	test('clicking the cell math reveals its source without touching the CST', async () => {
		await revealWidget(editor.mathWidget);
		await expect(editor.formulaCell).toContainText('$x^2$');
		// Showing the source is a view change only: the bytes are unchanged.
		expect(await editor.bridge.getSource()).toBe(SEED);
	});

	test('editing the source and pressing Enter re-renders and persists in the cell', async ({
		page
	}) => {
		await revealWidget(editor.mathWidget);
		await page.keyboard.press('Home'); // back to the cell start, wherever the press seated
		await page.keyboard.press('ArrowRight'); // past the opening `$`
		await page.keyboard.type('y');
		await page.keyboard.press('Enter');

		await expect(editor.mathWidget).toHaveCount(1);
		await editor.bridge.waitForSourceContains('$yx^2$');
		expect(await editor.bridge.getSource()).toBe(
			'| Formula | Note |\n| --- | --- |\n| $yx^2$ | ok |\n\nAfter\n'
		);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('a pipe typed into the revealed formula escapes on commit: the row never splits', async ({
		page
	}) => {
		await revealWidget(editor.mathWidget);
		await page.keyboard.press('Home'); // back to the cell start, wherever the press seated
		await page.keyboard.press('ArrowRight'); // past the opening `$`
		await page.keyboard.type('|');
		await page.keyboard.press('Enter');

		await expect(editor.mathWidget).toHaveCount(1);
		// The bare `|` committed as `\|`, so the two-column body row survives reparse
		// (an unescaped `|` would add a third column and mangle the whole table).
		expect(await editor.bridge.getSource()).toBe(
			'| Formula | Note |\n| --- | --- |\n| $\\|x^2$ | ok |\n\nAfter\n'
		);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('blur commits the edit as one undo entry', async ({ page }) => {
		await revealWidget(editor.mathWidget);
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('y');
		// Focus the trailing paragraph → the reveal commits on blur.
		await editor.getBlock(1).click();
		await editor.bridge.waitForSourceContains('$yx^2$');
		await expect(editor.mathWidget).toHaveCount(1);

		// One Ctrl+Z reverts the whole edit: a single entry, not one per keystroke.
		await editor.undo();
		await editor.bridge.waitForSourceContains('$x^2$');
		expect(await editor.bridge.getSource()).toBe(SEED);
	});

	test('Escape discards the source edit and restores the rendered widget', async ({ page }) => {
		await revealWidget(editor.mathWidget);
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('y');
		await page.keyboard.press('Escape');

		await expect(editor.mathWidget).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe(SEED);
	});

	test('Backspace at the cell trailing edge reveals the math, never deletes it', async ({
		page
	}) => {
		// Focus the formula cell without clicking its widget (a click would reveal):
		// enter from the Note cell and Shift+Tab back to the formula cell's end.
		await editor.noteCell.click();
		await page.keyboard.press('Shift+Tab');
		await expect(editor.formulaCell).toBeFocused();

		// Backspace at the widget's trailing edge enters it: a kind that can show its source does
		// so rather than deleting the widget whole.
		await page.keyboard.press('Backspace');
		await expect(editor.mathWidget).toHaveCount(0);
		await expect(editor.formulaCell).toContainText('$x^2$');
		expect(await editor.bridge.getSource()).toBe(SEED);
	});
});

import { test, expect } from '../../../fixtures';
import { PluginsPage, revealWidget, roundTripStable } from '../../plugins/helpers';

// Requirements: `e2e/requirements/blocks/table/cell-mutation-fold.md`.

class CellMathPage extends PluginsPage {
	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}
	async gotoMathTable() {
		await this.gotoPlugins('mathtable');
		await expect(this.mathWidget).toHaveCount(1);
	}
}

test.describe('a cell mutation folds the open reveal before it runs', () => {
	let editor: CellMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new CellMathPage(page);
		await editor.gotoMathTable();
	});

	// The row insert re-derives every row from each cell's `raw`, so a `_n` typed into the shown
	// source is lost with nothing to recover it, leaving a well-formed document behind.
	test('the row-insert chord commits the revealed edit rather than discarding it', async ({
		page
	}) => {
		await revealWidget(editor.mathWidget);
		await page.keyboard.press('ArrowLeft'); // inside the source, before the closing `$`
		await editor.typeSlowly('_n');

		await page.keyboard.press('ControlOrMeta+Enter');

		await editor.bridge.waitForSourceContains('_n');
		expect(await editor.bridge.getSource()).toContain('| --- | --- |');
		expect(await roundTripStable(page)).toBe(true);
	});

	// The same loss through an implicit commit: the toggle reads the shown DOM text and writes it
	// back as the cell's raw, leaving the source open over bytes it no longer matches.
	test('a format toggle folds first rather than committing the revealed source verbatim', async ({
		page
	}) => {
		await revealWidget(editor.mathWidget);
		await page.keyboard.press('ArrowLeft');
		await editor.typeSlowly('_n');

		await page.keyboard.press('ControlOrMeta+b');

		await editor.bridge.waitForSourceContains('_n');
		expect(await editor.bridge.getSource()).not.toContain('****$');
		expect(await roundTripStable(page)).toBe(true);
	});
});

import { test, expect } from '../../../fixtures';
import { PluginsPage } from '../../plugins/helpers';

// A table ends where the editor's grammar opens another block, a plugin's multi-line opener
// included. Driven on the plugins harness, which installs the latex plugin.
// Requirements: `e2e/requirements/blocks/table/table-end-grammar.md`.

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
const MATH = '$$\nx\n$$\n';

test.describe('a `$$` block right under a table', () => {
	test('loads as a math block, and a cell edit leaves its bytes alone', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await editor.loadContent(TABLE + MATH);

		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathBlock');

		await page.locator('.table-cell').nth(3).click();
		await page.keyboard.press('End');
		await page.keyboard.type('X');

		await expect
			.poll(() => editor.bridge.getSource())
			.toBe('| a | b |\n| --- | --- |\n| 1 | 2X |\n' + MATH);
		expect(await editor.parseConverged()).toBe(true);
	});
});

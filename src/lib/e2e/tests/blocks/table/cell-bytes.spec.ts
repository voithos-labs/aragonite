import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/table/cell-bytes.md`.

const TIGHT = '|a|b|\n|-|:-|\n|1|  2  |\n';

test.describe('a cell edit in a table not spelled the editor’s way', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TIGHT);
	});

	/** Types `Q` at the end of the `index`th cell, counting across the rows. */
	async function typeAtEnd(page: Page, index: number) {
		await page.locator('.table-cell').nth(index).click();
		await page.keyboard.press('End');
		await page.keyboard.type('Q');
	}

	test('a body cell changes alone', async ({ page }) => {
		await typeAtEnd(page, 2);

		await editor.bridge.waitForSourceContains('1Q');
		expect(await editor.bridge.getSource()).toBe('|a|b|\n|-|:-|\n|1Q|  2  |\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('a header cell changes alone', async ({ page }) => {
		await typeAtEnd(page, 1);

		await editor.bridge.waitForSourceContains('bQ');
		expect(await editor.bridge.getSource()).toBe('|a|bQ|\n|-|:-|\n|1|  2  |\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('an over-padded cell keeps its padding around the typed text', async ({ page }) => {
		await typeAtEnd(page, 3);

		await editor.bridge.waitForSourceContains('2Q');
		expect(await editor.bridge.getSource()).toBe('|a|b|\n|-|:-|\n|1|  2Q  |\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});

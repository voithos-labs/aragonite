import { type Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { gotoReady } from '../../../goto-ready';

// `/test/host-theme` mounts the editor with a host header inside its root, which is the only
// place focus can leave the blocks without leaving the editor. Requirements:
// e2e/requirements/sticky-column/triggers/host-header.md.

// A fresh column lands a glyph or two off on the next line; the column the run held, ~190px off.
const PIXEL_TOLERANCE = 40;

function caretX(page: Page): Promise<number> {
	return page.evaluate(() => {
		const range = window.getSelection()?.getRangeAt(0);
		if (!range) return NaN;
		return (range.getClientRects()[0] ?? range.getBoundingClientRect()).left;
	});
}

function focusInBlock(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const active = document.activeElement;
		return active instanceof HTMLElement && active.isContentEditable && !!active.closest('.editor');
	});
}

/** Tabs out of the header into the first block, whose caret starts at the left edge. */
async function tabBackIntoEditor(page: Page): Promise<void> {
	for (let i = 0; i < 5 && !(await focusInBlock(page)); i++) await page.keyboard.press('Tab');
	expect(await focusInBlock(page)).toBe(true);
}

const LEAVES = [
	{ name: 'a click on a header button', target: '.mode-toggle button.active' },
	{ name: "a click on the header's text", target: '.hero-title' }
];

test.describe('sticky column: a trip through the host header', () => {
	test.beforeEach(async ({ page }) => {
		await gotoReady(page, '/test/host-theme');
	});

	for (const { name, target } of LEAVES) {
		test(`${name} drops the column an arrow run held`, async ({ page }) => {
			await page.locator('.editor [contenteditable="true"]').first().click();
			await page.keyboard.press('End');
			await page.keyboard.press('ArrowDown');
			await page.keyboard.press('ArrowDown');

			await page.locator(target).click();
			await tabBackIntoEditor(page);
			const enteredX = await caretX(page);

			await page.keyboard.press('ArrowDown');
			expect(Math.abs((await caretX(page)) - enteredX)).toBeLessThan(PIXEL_TOLERANCE);
		});
	}
});

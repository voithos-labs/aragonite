import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { pointAtRaw } from '../../../text-runs';
import { skipUnlessSupported } from '../../../browser-engine';

// A finger's way to a table's row and column actions: the button at the focused cell, where a
// long press makes the cell's word the editor's range and opens no menu. Requirements:
// `requirements/blocks/table/cell-menu-button.md`.

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const BUTTON = '.table-cell-menu';

test.use({ hasTouch: true });

const cells = (page: Page) => page.locator('.table-cell');

async function tapCenter(page: Page, target: Locator): Promise<void> {
	const box = (await target.boundingBox())!;
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function open(page: Page): Promise<EditorPage> {
	skipUnlessSupported(page, 'touch');
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(TABLE);
	return editor;
}

test("a finger's long press in a cell opens no menu", async ({ page }) => {
	await open(page);
	const cell = cells(page).nth(2);
	await tapCenter(page, cell);
	const box = (await cell.boundingBox())!;
	await cell.evaluate(
		(el, at) => {
			const init = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y };
			el.dispatchEvent(new MouseEvent('contextmenu', init));
		},
		{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
	);
	await expect(cells(page).nth(2)).toBeFocused();
	await expect(page.getByRole('menu')).toHaveCount(0);
});

test("a finger's tap in a cell shows the button at that cell's corner, a mouse's click none", async ({
	page
}) => {
	const editor = await open(page);
	await tapCenter(page, cells(page).nth(2));
	const button = page.locator(BUTTON);
	await expect(button).toHaveCount(1);
	await expect(button).toHaveAccessibleName('Table actions');
	for (const at of [5, 3]) {
		await tapCenter(page, cells(page).nth(at));
		const cell = (await cells(page).nth(at).boundingBox())!;
		await expect
			.poll(async () => {
				const b = (await button.boundingBox())!;
				return [b.x + b.width / 2, b.y + b.height / 2].map(Math.round);
			})
			.toEqual([cell.x + cell.width, cell.y].map(Math.round));
	}
	await cells(page).nth(3).click();
	await expect(button).toHaveCount(0);
	await tapCenter(page, cells(page).nth(3));
	await expect(button).toHaveCount(1);
	await editor.setPresentationMode('reading');
	await expect(button).toHaveCount(0);
});

test("a finger's tap on the next cell's first letter moves there, past the button", async ({
	page
}) => {
	await open(page);
	await tapCenter(page, cells(page).nth(2));
	await expect(page.locator(BUTTON)).toHaveCount(1);
	// Just below the letter's middle, which the button's box stops short of and a 44 px box covers.
	const first = await pointAtRaw(page, [0, 1, 1], 0);
	await page.touchscreen.tap(first.x + 2, first.y + 2);
	await expect(cells(page).nth(3)).toBeFocused();
	await expect(page.getByRole('menu')).toHaveCount(0);
});

test('the button opens the cell menu without taking focus, and its Delete row takes the row', async ({
	page
}) => {
	const editor = await open(page);
	await tapCenter(page, cells(page).nth(2));
	await page.locator(BUTTON).evaluate((el) => {
		el.addEventListener('focus', () => ((window as any).__buttonFocused = true));
	});
	await tapCenter(page, page.locator(BUTTON));
	await expect(page.getByRole('menuitem', { name: 'Row', exact: true })).toBeVisible();
	expect(await page.evaluate(() => (window as any).__buttonFocused === true)).toBe(false);
	await tapCenter(page, page.getByRole('menuitem', { name: 'Delete row' }));
	await editor.bridge.waitForSourceEquals('| A | B |\n| --- | --- |\n| 3 | 4 |\n');
});

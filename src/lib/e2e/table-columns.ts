import { expect, type Locator, type Page } from '@playwright/test';
import { clickInPlace, hoverInPlace } from './click-in-place';

// The table's column moves and inserts, driven the way the page's platform's user drives them: the
// chord off a Mac, the cell menu's Column flyout on one, where Option+Arrow moves by word.

/** A column command, by the name the Column flyout gives it. */
export type ColumnCommand =
	'Move column left' | 'Move column right' | 'Insert column left' | 'Insert column right';

const CHORD: Record<ColumnCommand, string> = {
	'Move column left': 'Alt+ArrowLeft',
	'Move column right': 'Alt+ArrowRight',
	'Insert column left': 'Alt+Shift+ArrowLeft',
	'Insert column right': 'Alt+Shift+ArrowRight'
};

/** Runs `command` on the cell holding the caret. The page's own platform picks the route, so a
 *  page that reads as a Mac takes the menu off one too. */
export async function runColumnCommand(page: Page, command: ColumnCommand): Promise<void> {
	if (!(await pageIsMac(page))) {
		await page.keyboard.press(CHORD[command]);
		return;
	}
	const cell = page.locator('.table-cell:focus-within');
	await expect(cell).toHaveCount(1);
	await openFlyout(page, cell, 'Column');
	await clickInPlace(page.getByRole('menuitem', { name: command }));
}

/** Whether the page reads its platform as a Mac's, as the editor's conventions do. */
export function pageIsMac(page: Page): Promise<boolean> {
	return page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform));
}

/** Right-click a cell (a row-major index, or its locator) and hover a group row so its flyout
 *  is showing. */
export async function openFlyout(
	page: Page,
	cell: number | Locator,
	group: 'Row' | 'Column'
): Promise<void> {
	const target = typeof cell === 'number' ? page.locator('.table-cell').nth(cell) : cell;
	await clickInPlace(target, { button: 'right' });
	const row = page.getByRole('menuitem', { name: group, exact: true });
	await expect(row).toBeVisible();
	await hoverInPlace(row);
}

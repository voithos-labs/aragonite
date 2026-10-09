import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { enterPresentationMode } from './helpers';
import { CARD, URL_FIELD } from './link-card-helpers';
import { textRunCenter } from '../../text-runs';

// The right-click way into the link card: an "Edit link" row in the menu over a link, doing what
// Mod+K does there. Default host, so a plain click still opens the card too.
// Requirements: e2e/requirements/presentation/live-link-card-menu.md.

const DOC = 'Visit [example](https://example.com) now\n\nPlain words only\n';
const BLOCK_MENU = { name: 'Block actions' };
const EDIT_LINK = { name: 'Edit link' };

async function rightClickOn(page: Page, word: string): Promise<void> {
	const point = await textRunCenter(page, word);
	await page.mouse.click(point.x, point.y, { button: 'right' });
	await expect(page.getByRole('menu', BLOCK_MENU)).toBeVisible();
}

test.describe('the link card from the right-click menu', () => {
	test('Edit link on a link opens its card with focus in the URL field', async ({ page }) => {
		await enterPresentationMode(page, 'live', DOC);
		await rightClickOn(page, 'example');

		await page.getByRole('menuitem', EDIT_LINK).click();

		await expect(page.locator(CARD)).toBeVisible();
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com');
	});

	test('the menu over plain text offers no Edit link', async ({ page }) => {
		await enterPresentationMode(page, 'live', DOC);
		await rightClickOn(page, 'words');

		await expect(page.getByRole('menuitem', EDIT_LINK)).toHaveCount(0);
	});

	test('source mode shows the URL already, so its menu offers no Edit link', async ({ page }) => {
		await enterPresentationMode(page, 'source', DOC);
		await rightClickOn(page, 'example');

		await expect(page.getByRole('menuitem', EDIT_LINK)).toHaveCount(0);
	});
});

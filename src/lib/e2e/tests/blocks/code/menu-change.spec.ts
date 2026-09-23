import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// The code block's side gutter holds two menus, the host's overflow menu and the language
// picker, and both report on `menuChange`. Requirements: `requirements/blocks/code/menu-change.md`.
const SOURCE = '```js\nconst x = 1\n```\n\n# Heading\n';

const startCapture = (page: Page) =>
	page.evaluate(() => (window as any).__test.startMenuChangeCapture());
const stopCapture = (page: Page): Promise<boolean[]> =>
	page.evaluate(() => (window as any).__test.stopMenuChangeCapture());

const menuButton = (page: Page) => page.getByRole('button', { name: 'Code block actions' });
const railMenu = (page: Page) => page.locator('.code-rail-menu');
const picker = (page: Page) => page.locator('.code-lang-picker');

test.describe('code block: the gutter menus on menuChange', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		// The overflow menu shows only where the host supplies its items.
		await editor.goto('?codeActions=on&presentationMode=live');
		await editor.loadContent(SOURCE);
		await editor.getBlock(0).hover();
	});

	test('the overflow menu reads true on the click and false on Escape', async ({ page }) => {
		await startCapture(page);
		await menuButton(page).click();
		await expect(railMenu(page)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(railMenu(page)).toHaveCount(0);

		expect(await stopCapture(page)).toEqual([true, false]);
	});

	test('the language picker reads true on the chip click and false on Escape', async ({ page }) => {
		await startCapture(page);
		await page.locator('.code-lang-button').click();
		await expect(picker(page)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(picker(page)).toHaveCount(0);

		expect(await stopCapture(page)).toEqual([true, false]);
	});

	// Opening the picker closes the overflow menu in the same click; the host must not hear the
	// gutter close and reopen in between.
	test('the picker taking over from the open overflow menu stays one open', async ({ page }) => {
		await startCapture(page);
		await menuButton(page).click();
		await expect(railMenu(page)).toBeVisible();
		await page.locator('.code-lang-button').click();
		await expect(picker(page)).toBeVisible();
		await expect(railMenu(page)).toHaveCount(0);
		expect(await page.evaluate(() => (window as any).__test.stopMenuChangeCapture())).toEqual([
			true
		]);

		await startCapture(page);
		await page.keyboard.press('Escape');
		await expect(picker(page)).toHaveCount(0);
		expect(await stopCapture(page)).toEqual([false]);
	});
});

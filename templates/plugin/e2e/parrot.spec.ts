// The parrot in a real browser, driven by clicks and keys: what a reader of your plugin sees.
import { expect, test, type Page } from '@playwright/test';

const SEED = '%%parrot party responsibly\n\nAfter\n';

const source = (page: Page) => page.evaluate(() => window.editor.getSource());

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.parrot-block')).toHaveCount(1);
});

test('renders the bird and its caption, the source folded', async ({ page }) => {
	await expect(page.locator('.parrot')).toContainText('kkkk');
	await expect(page.locator('.parrot-caption')).toHaveText('party responsibly');
	await expect(page.locator('.parrot-source')).toHaveCount(0);
	expect(await source(page)).toBe(SEED);
});

test('a click on the caption opens the source line, bytes untouched', async ({ page }) => {
	await page.locator('.parrot-caption').click();
	await expect(page.locator('.parrot-source')).toBeFocused();
	await expect(page.locator('.parrot-source')).toHaveText('%%parrot party responsibly');
	expect(await source(page)).toBe(SEED);
});

test('typing then leaving folds the block, and the caption shows the new text', async ({
	page
}) => {
	await page.locator('.parrot-caption').click();
	await page.keyboard.press('End');
	await page.keyboard.type(' hard');
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('.parrot-source')).toHaveCount(0);
	await expect(page.locator('.parrot-caption')).toHaveText('party responsibly hard');
	expect(await source(page)).toBe('%%parrot party responsibly hard\n\nAfter\n');
});

test('one undo takes the whole edit back', async ({ page }) => {
	await page.locator('.parrot-caption').click();
	await page.keyboard.press('End');
	await page.keyboard.type(' hard');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(() => source(page)).toBe(SEED);
});

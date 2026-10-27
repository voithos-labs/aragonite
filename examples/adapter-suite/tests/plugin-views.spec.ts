import { test, expect, caretAtEnd, mirror } from './fixtures';
import { BLOCK_VIEWS_SOURCE } from '../block-views-source';
import { LIVE_VIEWS_ATTR } from '../live-views';
import type { Locator, Page } from '@playwright/test';

// An inline widget and a decoration badge drawn by the app's own framework components on the
// `?block-views` page. Requirements: requirements/plugin-views.md.

test.use({ anyWarning: true });

const framework = (projectName: string) => (projectName.startsWith('vue') ? 'vue' : 'react');

const liveViews = (page: Page) =>
	page.evaluate((attr) => document.documentElement.getAttribute(attr), LIVE_VIEWS_ATTR);

async function expectLiveViews(page: Page, count: number): Promise<void> {
	await expect.poll(() => liveViews(page)).toBe(String(count));
}

/** True while the element `locator` found first is still in the page. */
async function stillMounted(locator: Locator): Promise<() => Promise<boolean>> {
	const element = await locator.elementHandle();
	return () => element!.evaluate((el) => el.isConnected);
}

test.beforeEach(async ({ page }) => {
	await page.goto('/?block-views');
	await expect(page.locator('.editor')).toBeVisible();
});

test('the widget and the badge draw with the app components and context', async ({
	page
}, testInfo) => {
	const name = framework(testInfo.project.name);
	await expect(page.locator('.chip')).toHaveText(`pebble by ${name}`);
	await expect(page.locator('.memo-length')).toHaveText(`9 by ${name}`);
	await expectLiveViews(page, 2);
});

test('typing before the widget redraws the same element at its new offset', async ({ page }) => {
	const chip = page.locator('.chip');
	await expect(chip).toHaveAttribute('data-start', '2');
	const connected = await stillMounted(chip);

	await caretAtEnd(page, ' chip');
	await page.keyboard.press('Home');
	await page.keyboard.type('x');

	await expect(chip).toHaveAttribute('data-start', '3');
	expect(await connected()).toBe(true);
	await expect.poll(() => mirror(page).textContent()).toContain('xa {{pebble}} chip');
});

test('typing in the memo redraws the same badge with the new length', async ({
	page
}, testInfo) => {
	const badge = page.locator('.memo-length');
	await expect(badge).toHaveText(/^9 /);
	const connected = await stillMounted(badge);

	await caretAtEnd(page, '%% a memo');
	await page.keyboard.type('!');

	await expect(badge).toHaveText(`10 by ${framework(testInfo.project.name)}`);
	expect(await connected()).toBe(true);
});

test('deleting the widget unmounts its view', async ({ page }) => {
	await caretAtEnd(page, ' chip');
	for (let i = 0; i < ' chip'.length + 1; i++) await page.keyboard.press('Backspace');

	await expect(page.locator('.chip')).toHaveCount(0);
	await expect.poll(() => mirror(page).textContent()).not.toContain('{{pebble}}');
	await expectLiveViews(page, 1);
});

test('loading another document unmounts the old views and draws the new one', async ({ page }) => {
	await page.getByTestId('load').click();

	await expect(page.locator('.chip')).toHaveCount(0);
	await expect(page.locator('.memo-length')).toHaveText(/^15 /);
	await expectLiveViews(page, 1);
});

test('unmounting the editor unmounts every view, and mounting it draws them again', async ({
	page
}) => {
	const toggle = page.getByTestId('unmount');
	await toggle.click();
	await expect(page.locator('.editor')).toHaveCount(0);
	await expectLiveViews(page, 0);

	await toggle.click();
	await expect(page.locator('.chip')).toHaveCount(1);
	await expectLiveViews(page, 2);
	expect(await mirror(page).textContent()).toBe(BLOCK_VIEWS_SOURCE);
});

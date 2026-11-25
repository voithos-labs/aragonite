import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';
import { attachIme } from '../../simulation/ime';

/**
 * A follow widget's keys (requirements/plugins/widget-follow-keys.md): the `@home` chip of
 * `routes/test/plugins/follow-keys`, a tab stop holding a button, whose `follow` and button each
 * record the name.
 */

const CHIP = '.follow-chip';
const BUTTON = '.follow-chip-button';
const SEED = 'Go to @home now\n\nAfter\n';

const records = (page: Page): Promise<{ followed: string[]; pressed: string[] }> =>
	page.evaluate(() => {
		const probe = window as { __followedChips?: string[]; __chipButtons?: string[] };
		return { followed: probe.__followedChips ?? [], pressed: probe.__chipButtons ?? [] };
	});

test.describe("a follow widget's keys", () => {
	let ep: PluginsPage;

	test.beforeEach(async ({ page }) => {
		ep = new PluginsPage(page);
		await ep.gotoPlugins('follow-keys');
		await expect(page.locator(CHIP)).toContainText('home');
	});

	test('reading mode: Enter and Space on the focused chip each follow', async ({ page }) => {
		await ep.setPresentationMode('reading');
		await page.locator(CHIP).focus();
		await page.keyboard.press('Enter');
		await page.keyboard.press(' ');
		expect(await records(page)).toEqual({ followed: ['home', 'home'], pressed: [] });
		expect(await capturedErrors(page)).toEqual([]);
	});

	test("reading mode: Enter and Space on the chip's button press it, and nothing follows", async ({
		page
	}) => {
		await ep.setPresentationMode('reading');
		await page.locator(BUTTON).focus();
		await page.keyboard.press('Enter');
		await page.keyboard.press(' ');
		expect(await records(page)).toEqual({ followed: [], pressed: ['home', 'home'] });
	});

	test("reading mode: a click on the chip's button presses it, and nothing follows", async ({
		page
	}) => {
		await ep.setPresentationMode('reading');
		await page.locator(BUTTON).click();
		expect(await records(page)).toEqual({ followed: [], pressed: ['home'] });
	});

	test('reading mode: an IME key on the focused chip follows nothing', async ({ page }) => {
		await ep.setPresentationMode('reading');
		await page.locator(CHIP).focus();
		await (await attachIme(page)).openingKey('Enter');
		expect((await records(page)).followed).toEqual([]);
	});

	test('plain link click: Enter on the focused chip follows in live mode', async ({ page }) => {
		await ep.setPresentationMode('live');
		await page.locator(CHIP).focus();
		await page.keyboard.press('Enter');
		expect((await records(page)).followed).toEqual(['home']);
		expect(await ep.bridge.getSource()).toBe(SEED);
	});

	test('plain link click: Enter on the focused chip follows nothing in source mode', async ({
		page
	}) => {
		await ep.setPresentationMode('source');
		await page.locator(CHIP).focus();
		await page.keyboard.press('Enter');
		expect((await records(page)).followed).toEqual([]);
	});

	test('modifier link click: Enter on the focused chip follows nothing in live mode', async ({
		page
	}) => {
		await page.getByTestId('link-click-toggle').click();
		await ep.setPresentationMode('live');
		await page.locator(CHIP).focus();
		await page.keyboard.press('Enter');
		expect((await records(page)).followed).toEqual([]);
	});
});

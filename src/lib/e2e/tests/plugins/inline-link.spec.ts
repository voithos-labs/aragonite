import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage } from './helpers';
import { commitUrl, openCardOn, TEXT_FIELD } from '../presentation/link-card-helpers';
import { clickInPlace } from '../../click-in-place';

/**
 * An `inline()` construct reading `[[target|text]]` as a built-in link: every route that edits a
 * link in live mode meets bytes that aren't GFM, and none may write GFM over them.
 */

const LINK = '[[note|Shown]]';
// Raw offsets in block 0: the text `Shown` runs from 11 to 16.
const TEXT_START = 11;
const TEXT_END = 16;

test.describe('an inline construct read as a link', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-link');
		await editor.setPresentationMode('live');
	});

	const source = () => editor.bridge.getSource();

	async function expectOwnBytes(): Promise<string> {
		const src = await source();
		expect(src).not.toContain('](');
		return src;
	}

	test('shows its text and hides the rest of its bytes', async ({ page }) => {
		await expect(page.locator('.md-link-content').first()).toHaveText('Shown');
	});

	test('Mod+K opens its card, and a new URL is written in its own syntax', async ({ page }) => {
		await editor.focusBlockAtPath([0], 13);
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.locator('[data-link-card]')).toBeVisible();
		await commitUrl(page, 'https://example.org/page');
		await editor.bridge.waitForSourceContains('[[page|Shown]]');
		await expectOwnBytes();
	});

	test('a new text in the card is written in its own syntax', async ({ page }) => {
		await openCardOn(editor, page, 'Shown');
		await clickInPlace(page.locator(TEXT_FIELD));
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('Other');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('[[note|Other]]');
	});

	test('Enter inside the text cuts at its edge, the claim whole', async ({ page }) => {
		await editor.focusBlockAtPath([0], TEXT_START + 1);
		await page.keyboard.press('Enter');
		await expect.poll(source).toMatch(/\n\n/);
		const src = await expectOwnBytes();
		expect(src.split('\n').some((line) => line.includes(LINK))).toBe(true);
	});

	test('Backspace through the whole text takes the claim whole', async ({ page }) => {
		await editor.focusBlockAtPath([0], TEXT_END);
		for (let i = 0; i < 'Shown'.length; i++) await page.keyboard.press('Backspace');
		await expect.poll(source).toBe('See  here\n\nAfter\n');
	});

	test('a range past the text deletes only what shows', async ({ page }) => {
		await selectFrom(page, 13, 6);
		await page.keyboard.press('Backspace');
		await expect.poll(source).toBe('See [[note|Sh]]re\n\nAfter\n');
	});

	for (const [edge, at, expected] of [
		['start', TEXT_START, 'See x[[note|Shown]] here\n\nAfter\n'],
		['end', TEXT_END, 'See [[note|Shown]]x here\n\nAfter\n']
	] as const) {
		test(`a letter at the text's ${edge} lands outside the link`, async ({ page }) => {
			await editor.focusBlockAtPath([0], at);
			await page.keyboard.type('x');
			await expect.poll(source).toBe(expected);
		});
	}

	test('Mod+B across its edge writes no GFM over it', async ({ page }) => {
		await selectFrom(page, 2, 5);
		await page.keyboard.press('ControlOrMeta+b');
		await editor.waitForRenderFlush();
		expect(await expectOwnBytes()).toContain(LINK);
	});

	async function selectFrom(page: Page, offset: number, chars: number): Promise<void> {
		await editor.focusBlockAtPath([0], offset);
		for (let i = 0; i < chars; i++) await page.keyboard.press('Shift+ArrowRight');
	}
});

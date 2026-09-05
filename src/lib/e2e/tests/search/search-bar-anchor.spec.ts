import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { findInput, openFind, overlays, replaceInput, typeQuery } from './helpers';

const anchor = (page: Page) => page.getByTestId('search-anchor');
const anchoredBar = (page: Page) => anchor(page).locator('.search-bar');
const rootBar = (page: Page) => page.locator('.editor .search-bar');

// `--color-border` is declared only in the theme scope, and the find input's inline
// fallback is a DIFFERENT grey — so the computed value says which one resolved.
const TOKEN_DARK = 'rgb(61, 64, 71)';
const TOKEN_LIGHT = 'rgb(208, 215, 222)';
const INLINE_FALLBACK = 'rgb(68, 71, 79)';

const inputBorderColor = (page: Page) =>
	findInput(page).evaluate((el) => getComputedStyle(el).borderTopColor);

test.describe('search bar — consumer anchor', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?searchAnchor=on');
		await editor.loadContent('alpha beta\n\ngamma alpha\n');
	});

	test('Ctrl+F renders the bar inside the anchor, not the editor root', async ({ page }) => {
		await openFind(editor);
		await expect(anchoredBar(page)).toBeVisible();
		await expect(rootBar(page)).toHaveCount(0);
		await expect(findInput(page)).toBeFocused();
	});

	test('typing in the anchored bar paints the document highlights', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(overlays(page)).toHaveCount(2);
	});

	test('Ctrl+H opens the anchored bar with the replace row expanded', async ({ page }) => {
		await editor.clickBlock(0);
		await page.keyboard.press('ControlOrMeta+h');
		await expect(replaceInput(page)).toBeVisible();
		await expect(anchoredBar(page)).toBeVisible();
	});

	test('theme tokens resolve inside the anchor and follow a live theme flip', async ({ page }) => {
		await openFind(editor);
		// The anchor sits outside every `.aragonite-editor-theme` ancestor, so this value can
		// only come from the scope the portaled node brought with it.
		expect(await inputBorderColor(page)).toBe(TOKEN_DARK);
		expect(await inputBorderColor(page)).not.toBe(INLINE_FALLBACK);

		await page.getByTestId('theme-toggle').click();
		await expect.poll(() => inputBorderColor(page)).toBe(TOKEN_LIGHT);
	});

	test('dropping the anchor returns the open bar home, query intact', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(overlays(page)).toHaveCount(2);

		await page.getByTestId('anchor-toggle').click();
		await expect(rootBar(page)).toBeVisible();
		await expect(anchoredBar(page)).toHaveCount(0);
		await expect(findInput(page)).toHaveValue('alpha');
		await expect(overlays(page)).toHaveCount(2);

		await page.getByTestId('anchor-toggle').click();
		await expect(anchoredBar(page)).toBeVisible();
		await expect(rootBar(page)).toHaveCount(0);
	});

	test('Esc closes the anchored bar and the next keystroke lands at the pre-search caret', async ({
		page
	}) => {
		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await page.keyboard.press('ControlOrMeta+f');
		await expect(findInput(page)).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(findInput(page)).toHaveCount(0);
		await page.keyboard.type('!');
		await editor.bridge.waitForSourceContains('alpha beta!');
	});
});

test.describe('search bar — no anchor supplied', () => {
	test('the bar renders in the editor root, as it always has', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('alpha beta\n');
		await openFind(editor);
		await expect(page.locator('.editor > .search-anchor .search-bar')).toBeVisible();
	});
});

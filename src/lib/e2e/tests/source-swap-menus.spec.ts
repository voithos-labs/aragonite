import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { enterPresentationMode } from './presentation/helpers';
import { CARD, openCardOn } from './presentation/link-card-helpers';
import { PluginsPage } from './plugins/helpers';

// A menu acts on the document and the mode it opened over, so a `source` swap and a mode change
// close every open one. Requirements: `requirements/source-swap-menus.md`.
const INCOMING = 'alpha\n\nbeta\n\ngamma\n';
const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
const FENCE = '```js\nconst x = 1\n```\n\n# Heading\n';

const startCapture = (page: Page) =>
	page.evaluate(() => (window as any).__test.startMenuChangeCapture());
const stopCapture = (page: Page): Promise<boolean[]> =>
	page.evaluate(() => (window as any).__test.stopMenuChangeCapture());

async function openTableMenu(page: Page): Promise<void> {
	await page.locator('.table-cell').nth(2).click();
	await page.keyboard.press('Shift+F10');
	await expect(page.getByRole('menu', { name: 'Table actions' })).toBeVisible();
}

/** A live fence whose gutter carries the host's overflow menu. */
async function liveFence(page: Page): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto('?codeActions=on&presentationMode=live');
	await editor.loadContent(FENCE);
	await editor.getBlock(0).hover();
	return editor;
}

async function openCodeMenu(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Code block actions' }).click();
	await expect(page.locator('.code-rail-menu')).toBeVisible();
}

test.describe('a source swap closes every open menu', () => {
	test('the block menu closes, reports closing, and its pick never runs', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('first\n\n```\ncode\n```\n\nlast\n');
		await page.evaluate(() => (window as any).__test.startMenuChangeCapture());
		await page.locator('[data-block-kind="fencedCode"]').first().click({ button: 'right' });
		await expect(page.getByRole('menu', { name: 'Block actions' })).toBeVisible();

		await editor.loadContent(INCOMING);

		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await page.evaluate(() => (window as any).__test.stopMenuChangeCapture())).toEqual([
			true,
			false
		]);
		expect(await editor.bridge.getSource()).toBe(INCOMING);
	});

	test('the link card closes', async ({ page }) => {
		const editor = await enterPresentationMode(
			page,
			'live',
			'Visit [example](https://example.com) now\n'
		);
		await openCardOn(editor, page, 'example');

		await editor.loadContent(INCOMING);

		await expect(page.locator(CARD)).toHaveCount(0);
	});

	test('the inline menu closes', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(2);
		await editor.typeText(' #');
		await expect(page.locator('[data-inline-menu]')).toBeVisible();

		await editor.loadContent(INCOMING);

		await expect(page.locator('[data-inline-menu]')).toHaveCount(0);
	});

	test('the table menu closes and reports closing', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
		await startCapture(page);
		await openTableMenu(page);

		await editor.loadContent(INCOMING);

		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await stopCapture(page)).toEqual([true, false]);
	});

	test('the code block overflow menu closes', async ({ page }) => {
		const editor = await liveFence(page);
		await openCodeMenu(page);

		await editor.loadContent(INCOMING);

		await expect(page.locator('.code-rail-menu')).toHaveCount(0);
	});
});

test.describe('a mode change closes every open menu', () => {
	test('the table menu closes on a switch to reading, and the table keeps its bytes', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
		await startCapture(page);
		await openTableMenu(page);

		await editor.setPresentationMode('reading');

		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await stopCapture(page)).toEqual([true, false]);
		expect(await editor.bridge.getSource()).toBe(TABLE);
	});

	test('the code block overflow menu closes on a switch to reading', async ({ page }) => {
		const editor = await liveFence(page);
		await startCapture(page);
		await openCodeMenu(page);

		await editor.setPresentationMode('reading');

		await expect(page.locator('.code-rail-menu')).toHaveCount(0);
		expect(await stopCapture(page)).toEqual([true, false]);
	});

	test('the code block language picker closes on a switch to reading', async ({ page }) => {
		const editor = await liveFence(page);
		await page.locator('.code-lang-button').click();
		await expect(page.locator('.code-lang-picker')).toBeVisible();

		await editor.setPresentationMode('reading');

		await expect(page.locator('.code-lang-picker')).toHaveCount(0);
	});
});

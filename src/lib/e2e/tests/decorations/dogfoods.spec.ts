import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage, activeBlockPath } from '../plugins/helpers';

/**
 * Decoration dogfoods (requirements/decorations/dogfoods.md): two reference plugins built on
 * PUBLIC doors only — `highlight-occurrences` over the mark overlay, `ghost-text` over the
 * widget-island render path.
 */

const OCCURRENCE = '.decoration-overlay.hl-occurrence';
const ISLAND = '[data-decoration-island]';
const GHOST = `${ISLAND} .ghost-text`;

async function cursorOffset(page: Page, path: number[]): Promise<number | null> {
	return page.evaluate((p) => (window as any).__test.getBlockCursorSurface(p).cursorOffset, path);
}

/** Collapse the caret immediately after the ghost island — the element-level
 *  boundary position with no adjacent text node (the island sits at block end).
 *  Setup only; the keystrokes under test are real. */
async function placeCaretAfterIsland(page: Page): Promise<void> {
	await page.evaluate(() => {
		const island = document.querySelector('[data-decoration-island]');
		const block = island?.closest('[contenteditable]') as HTMLElement | null;
		if (!block || !island) throw new Error('ghost island not rendered');
		block.focus();
		const range = document.createRange();
		range.setStartAfter(island);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	});
}

test.describe('highlight-occurrences dogfood', () => {
	let editor: PluginsPage;

	// Seed: 'cat' occurs twice in block 0 and once in block 1; 'catalog' in
	// block 2 must never match (whole-word scan).
	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('hloccur');
	});

	test('clicking into a word marks all whole-word occurrences across blocks', async ({ page }) => {
		// Offset 5 lands inside the first 'cat' of block 0.
		await editor.clickBlockAtPath([0], 5);
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);
	});

	test('moving the caret to another word moves the marks; whitespace clears them', async ({
		page
	}) => {
		await editor.clickBlockAtPath([0], 5);
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);

		// 'mat' occurs once — the marks must follow the caret, not stick to 'cat'.
		await editor.clickBlockAtPath([0], 13);
		await expect(page.locator(OCCURRENCE)).toHaveCount(1);

		// Block 2 ends in '.', so End puts the caret against a non-word char.
		await editor.focusBlockEnd(2);
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);
	});

	test('typing an extra occurrence recomputes the marks', async ({ page }) => {
		await editor.clickBlockAtPath([1], 2);
		await expect(page.locator(OCCURRENCE)).toHaveCount(3);

		await editor.focusBlockEnd(1);
		await editor.typeSlowly(' cat');
		await expect(page.locator(OCCURRENCE)).toHaveCount(4);
	});
});

test.describe('ghost-text dogfood', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('ghost');
	});

	test('the ghost island renders at the focused paragraph end, on that block only', async ({
		page
	}) => {
		await editor.clickBlock(0);
		await expect(page.locator(`[data-block-path='[0]'] ${GHOST}`)).toHaveCount(1);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await editor.clickBlock(1);
		await expect(page.locator(`[data-block-path='[1]'] ${GHOST}`)).toHaveCount(1);
		await expect(page.locator(ISLAND)).toHaveCount(1);
	});

	test('the caret survives the island appearing where it was clicked', async ({ page }) => {
		await editor.clickBlockAtPath([0], 3);
		await expect(page.locator(GHOST)).toHaveCount(1);
		expect(await cursorOffset(page, [0])).toBe(3);
	});

	test('typing at the paragraph end inserts into the source, never the ghost text', async ({
		page
	}) => {
		await editor.clickBlockAtPath([0], 11);
		await expect(page.locator(GHOST)).toHaveCount(1);

		await editor.typeSlowly('!!');
		await editor.bridge.waitForSourceContains('Hello world!!');
		const source = await editor.bridge.getSource();
		expect(source).toBe('Hello world!!\n\nSecond paragraph\n');
	});

	test('typing at the island element-level boundary inserts at the raw offset', async ({
		page
	}) => {
		await editor.clickBlock(0);
		await expect(page.locator(GHOST)).toHaveCount(1);

		// The island keydown branch is cross-browser defence for engines that drop printable keys
		// at an element-level caret; Chromium types natively here, so only the unit suite pins it.
		await placeCaretAfterIsland(page);
		await editor.typeSlowly('z');
		await editor.bridge.waitForSourceContains('Hello worldz');
		expect(await editor.bridge.getSource()).toBe('Hello worldz\n\nSecond paragraph\n');
	});

	test('ArrowRight at the last text offset leaves the block — the island never traps', async ({
		page
	}) => {
		await editor.clickBlockAtPath([0], 11);
		await expect(page.locator(GHOST)).toHaveCount(1);

		// Two presses cover both step orders (over-the-island then out, or straight
		// out); either way the caret must end up in block 1.
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => activeBlockPath(page)).toEqual([1]);
	});

	test('an empty paragraph keeps its caret anchor under the ghost island', async ({ page }) => {
		await editor.clickBlockAtPath([0], 11);
		await page.keyboard.press('Enter');
		await expect.poll(() => editor.getDomBlockCount()).toBe(3);
		await expect(page.locator(`[data-block-path='[1]'] ${GHOST}`)).toHaveCount(1);

		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('x');
		// The split-trivia shape is the plain editor's own Enter result, verified
		// ghost-free; this pins that the ghost island changes none of those bytes
		// and the empty block still takes input.
		expect(await editor.bridge.getSource()).toBe('Hello world\n\nx\n\nSecond paragraph\n');
	});
});

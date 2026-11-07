import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';

/**
 * Spell check (requirements/decorations/spellcheck.md): the built-in checker's waves, the
 * suggestion rows in the hover menu, the right-click menu and the selection toolbar, and the
 * three modes.
 */

const WAVE = '.spell-overlay';
const TEXT = 'This is a tset of speling.\n';

test.describe('spell check', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('misspelled words get a wave, correct ones and code none', async ({ page }) => {
		await editor.loadContent(TEXT + '\n```\ntset\n```\n');
		await expect(page.locator(WAVE)).toHaveCount(2);
		const [first, second] = await page.locator(WAVE).all();
		const wordRect = await page.evaluate(() => {
			const rects = (window as any).__test.rects.rangeRects([0], 10, 14) as DOMRect[];
			return { left: rects[0].left, right: rects[0].right };
		});
		const firstBox = (await first.boundingBox())!;
		expect(Math.abs(firstBox.x - wordRect.left)).toBeLessThan(2);
		expect(Math.abs(firstBox.x + firstBox.width - wordRect.right)).toBeLessThan(2);
		expect((await second.boundingBox())!.y).toBeCloseTo(firstBox.y, 0);
		await expect(editor.getBlock(0)).toHaveAttribute('spellcheck', 'false');
	});

	test('resting the pointer on the word opens its suggestions alone, and a pick rewrites it', async ({
		page
	}) => {
		await editor.loadContent(TEXT);
		await expect(page.locator(WAVE)).toHaveCount(2);
		const word = await pointAtRaw(page, [0], 12);
		await page.mouse.move(word.x, word.y - 40);
		await page.mouse.move(word.x, word.y);
		// Not on arrival: the menu waits for the pointer to rest.
		expect(await page.getByRole('menu').count()).toBe(0);
		const rows = page.getByRole('menuitem');
		await expect(rows.first()).toHaveText('test');
		await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toHaveCount(0);
		// The word still takes the click: no caret moved, no menu left behind.
		const menu = page.getByRole('menu', { name: 'Spelling suggestions' });
		const box = (await menu.boundingBox())!;
		await page.mouse.move(box.x + 10, box.y + 10);
		await expect(menu).toBeVisible();
		await rows.first().click();
		await editor.bridge.waitForSourceEquals('This is a test of speling.\n');
		await expect(menu).toHaveCount(0);
	});

	test('leaving the word and the menu closes the hover menu', async ({ page }) => {
		await editor.loadContent(TEXT + '\nfar away\n');
		await expect(page.locator(WAVE)).toHaveCount(2);
		const word = await pointAtRaw(page, [0], 12);
		await page.mouse.move(word.x, word.y - 40);
		await page.mouse.move(word.x, word.y);
		const menu = page.getByRole('menu', { name: 'Spelling suggestions' });
		await expect(menu).toBeVisible();
		// Far to the right on the same line: off every word, and nowhere near the menu below it.
		await page.mouse.move(word.x + 600, word.y);
		await expect(menu).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(TEXT + '\nfar away\n');
	});

	test('the right-click menu leads with the suggestions, and a pick rewrites the word', async ({
		page
	}) => {
		await editor.loadContent(TEXT);
		await expect(page.locator(WAVE)).toHaveCount(2);
		const point = await pointAtRaw(page, [0], 12);
		await page.mouse.click(point.x, point.y, { button: 'right' });
		const rows = page.getByRole('menuitem');
		await expect(rows.first()).toHaveText('test');
		await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeVisible();
		await rows.first().click();
		await editor.bridge.waitForSourceEquals('This is a test of speling.\n');
		await expect(page.locator(WAVE)).toHaveCount(1);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TEXT);
	});

	test('Add to dictionary takes the wave off that word', async ({ page }) => {
		await editor.loadContent(TEXT);
		await expect(page.locator(WAVE)).toHaveCount(2);
		const point = await pointAtRaw(page, [0], 12);
		await page.mouse.click(point.x, point.y, { button: 'right' });
		await page.getByRole('menuitem', { name: 'Add to dictionary' }).click();
		await expect(page.locator(WAVE)).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe(TEXT);
	});

	test('selecting exactly the word gives the toolbar a Spelling row that rewrites it', async ({
		page
	}) => {
		await editor.loadContent(TEXT);
		await expect(page.locator(WAVE)).toHaveCount(2);
		await editor.focusBlock(0, 10);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		const row = page.getByTestId('toolbar-spelling');
		await expect(row).toBeVisible();
		await row.hover();
		const suggestion = page.getByTestId('toolbar-spelling-suggestion').first();
		await expect(suggestion).toHaveText('test');
		await suggestion.click();
		await editor.bridge.waitForSourceEquals('This is a test of speling.\n');
	});

	test('the word being typed stays plain until the caret leaves it', async ({ page }) => {
		await editor.loadContent('This is\n');
		await expect(page.locator(WAVE)).toHaveCount(0);
		await editor.focusBlockEnd(0);
		await editor.typeText(' tset');
		await editor.bridge.waitForSourceEquals('This is tset\n');
		await editor.waitForRenderFlush();
		await expect(page.locator(WAVE)).toHaveCount(0);
		await editor.typeText(' ');
		await expect(page.locator(WAVE)).toHaveCount(1);
	});
});

test.describe('spell check: the native mode', () => {
	test('hands the words to the browser checker and draws no waves of its own', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto('?spellcheck=native');
		await editor.loadContent(TEXT);
		await expect(editor.getBlock(0)).toHaveAttribute('spellcheck', 'true');
		await editor.waitForRenderFlush();
		await expect(page.locator(WAVE)).toHaveCount(0);
	});
});

test.describe('spell check: off', () => {
	test('draws no waves and keeps the browser checker off', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto('?spellcheck=off');
		await editor.loadContent(TEXT);
		await expect(editor.getBlock(0)).toHaveAttribute('spellcheck', 'false');
		await editor.waitForRenderFlush();
		await expect(page.locator(WAVE)).toHaveCount(0);
	});
});

import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/**
 * Selection toolbar (requirements/decorations/selection-toolbar.md): the demo
 * route's consumer-side rect-API example. Selections are made with real mouse
 * and keyboard gestures; assertions read the fixed bar's geometry against the
 * live selection's rects.
 */

const TOOLBAR = '[data-testid="selection-toolbar"]';

async function firstSelectionRect(page: EditorPage['page']) {
	return page.evaluate(() => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
		const rect = sel.getRangeAt(0).getClientRects()[0];
		return rect ? { top: rect.top, left: rect.left } : null;
	});
}

test.describe('selection toolbar', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('selecting inside a paragraph shows the bar above the selection first rect', async ({
		page
	}) => {
		await editor.loadContent('select some of this text\n\nsecond block\n');
		await editor.focusBlock(0, 7);
		for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowRight');

		const toolbar = page.locator(TOOLBAR);
		await expect(toolbar).toBeVisible();
		const bar = await toolbar.boundingBox();
		const rect = await firstSelectionRect(page);
		expect(rect).not.toBeNull();
		expect(bar!.y + bar!.height).toBeLessThanOrEqual(rect!.top + 1);
		expect(Math.abs(bar!.x - rect!.left)).toBeLessThan(20);
	});

	test('collapsing the selection hides the bar', async ({ page }) => {
		await editor.loadContent('select some of this text\n\nsecond block\n');
		await editor.focusBlock(0, 7);
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator(TOOLBAR)).toBeVisible();

		await editor.clickBlock(1);
		await expect(page.locator(TOOLBAR)).toBeHidden();
	});

	test('a mid-line start in a wrapped paragraph anchors at rect[0], not the union', async ({
		page
	}) => {
		const line = 'word '.repeat(120).trim();
		await editor.loadContent(`${line}\n`);
		await editor.focusBlock(0, 40);
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowDown');

		const toolbar = page.locator(TOOLBAR);
		await expect(toolbar).toBeVisible();
		const bar = await toolbar.boundingBox();
		const rect = await firstSelectionRect(page);
		// rect[0] starts mid-line; the multi-line union would start at the block's
		// left edge, far left of the selection start.
		expect(rect!.left).toBeGreaterThan(50);
		expect(Math.abs(bar!.x - rect!.left)).toBeLessThan(20);
		expect(bar!.y + bar!.height).toBeLessThanOrEqual(rect!.top + 1);
	});

	test('a cross-block selection anchors above the start block via rangeRects', async ({ page }) => {
		await editor.loadContent('first block here\n\nsecond block below\n');
		await editor.focusBlockStart(0);
		await editor.shiftClickBlock([1], 6);
		await editor.waitForCrossBlock(true);

		const toolbar = page.locator(TOOLBAR);
		await expect(toolbar).toBeVisible();
		const bar = await toolbar.boundingBox();
		const blockTop = await page.evaluate(
			() => (window as any).__test.rects.blockRect([0]).top as number
		);
		expect(bar!.y + bar!.height).toBeLessThanOrEqual(blockTop + 1);
	});
});

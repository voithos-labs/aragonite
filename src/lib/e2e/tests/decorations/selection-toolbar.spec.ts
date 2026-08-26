import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/**
 * Selection toolbar (requirements/decorations/selection-toolbar.md): the demo route's
 * consumer-side rect-API example, driven with real mouse and keyboard gestures.
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

	// The recipe's focus rule: without the mousedown cancel the press moves focus to the button,
	// the door resolves no surface, and the click silently does nothing.
	test('the bold button wraps the selection without stealing the caret', async ({ page }) => {
		await editor.loadContent('select some of this text\n\nsecond block\n');
		await editor.focusBlock(0, 7);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator(TOOLBAR)).toBeVisible();

		await page.locator('[data-testid="toolbar-format.toggleStrong"]').click();

		await editor.bridge.waitForSourceContains('select **some** of this text');
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

	test('the bold button paints pressed inside bold text and unpressed outside', async ({
		page
	}) => {
		await editor.loadContent('plain **bold words** after\n');
		await editor.focusBlock(0, 8);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');

		const bold = page.locator('[data-testid="toolbar-format.toggleStrong"]');
		await expect(bold).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('[data-testid="toolbar-format.toggleEmphasis"]')).toHaveAttribute(
			'aria-pressed',
			'false'
		);

		await editor.focusBlock(0, 0);
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(bold).toHaveAttribute('aria-pressed', 'false');
	});

	// The affordance the split owes a reader: the toggles stay live because they have a
	// cross-block arm, and only the button the door would still refuse is visibly dead.
	test('a cross-block selection greys only the link editor out', async ({ page }) => {
		await editor.loadContent('first block here\n\nsecond block below\n');
		await editor.focusBlockStart(0);
		await editor.shiftClickBlock([1], 6);
		await editor.waitForCrossBlock(true);

		await expect(page.locator(TOOLBAR)).toBeVisible();
		await expect(page.locator('[data-testid="toolbar-format.toggleStrong"]')).toBeEnabled();
		await expect(page.locator('[data-testid="toolbar-link.openCard"]')).toBeDisabled();
	});

	// Same-kind nesting, where the bar paints pressed for a run the press does not address: over a
	// bare delimiter byte there is no content to unformat, and over the inner run the outer one goes
	// on covering whatever the strip leaves.
	test('the strike button declines over a bare delimiter and splits the outer run over the inner', async ({
		page
	}) => {
		await editor.loadContent('~~a ~b~ c~~\n');
		const strike = page.locator('[data-testid="toolbar-format.toggleStrikethrough"]');

		await editor.focusBlock(0, 4);
		await page.keyboard.press('Shift+ArrowRight');
		await expect(strike).toHaveAttribute('aria-pressed', 'true');
		await strike.click();

		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('~~a ~b~ c~~\n');
		expect(await editor.bridge.getSelectionPaths()).toMatchObject({
			anchor: { offset: 4 },
			focus: { offset: 5 }
		});

		for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(strike).toHaveAttribute('aria-pressed', 'true');
		await strike.click();

		await editor.bridge.waitForSourceEquals('~~a~~ b ~~c~~\n');
		await expect(strike).toHaveAttribute('aria-pressed', 'false');
	});

	test('the bold button over a cross-block selection wraps every block and paints pressed', async ({
		page
	}) => {
		await editor.loadContent('first block\n\nsecond block\n');
		await editor.focusBlock(0, 3);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		const bold = page.locator('[data-testid="toolbar-format.toggleStrong"]');
		await expect(bold).toHaveAttribute('aria-pressed', 'false');
		await bold.click();

		await editor.bridge.waitForSourceEquals('**first block**\n\n**second block**\n', 3000);
		await expect(bold).toHaveAttribute('aria-pressed', 'true');
	});
});

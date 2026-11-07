import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';
import { extendKey } from '../../platform-keys';

/**
 * Selection toolbar (requirements/decorations/selection-toolbar.md): the editor's own
 * popover, mounted by the harness through the default prop, driven with real mouse and
 * keyboard gestures.
 */

const TOOLBAR = '[data-testid="selection-toolbar"]';

async function firstSelectionRect(page: EditorPage['page']) {
	return page.evaluate(() => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
		const rect = sel.getRangeAt(0).getClientRects()[0];
		return rect ? { top: rect.top, left: rect.left, bottom: rect.bottom } : null;
	});
}

/** The box of the selection's last line, where a wrapped range ends. */
async function lastSelectionRect(page: EditorPage['page']) {
	return page.evaluate(() => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
		const rects = [...sel.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0);
		const rect = rects[rects.length - 1];
		return rect ? { top: rect.top, right: rect.right, bottom: rect.bottom } : null;
	});
}

test.describe('selection toolbar', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('selecting inside a paragraph opens the bar below and right of the selection', async ({
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
		// Below the selected line and starting past where the selection ends, never over it.
		expect(bar!.y).toBeGreaterThanOrEqual(rect!.bottom - 1);
		expect(bar!.x).toBeGreaterThanOrEqual(rect!.left);
	});

	test('collapsing the selection hides the bar', async ({ page }) => {
		await editor.loadContent('select some of this text\n\nsecond block\n');
		await editor.focusBlock(0, 7);
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator(TOOLBAR)).toBeVisible();

		await editor.clickBlock(1);
		await expect(page.locator(TOOLBAR)).toBeHidden();
	});

	// The focus rule from the toolbar recipe: without cancelling mousedown the click moves focus
	// to the button, the command finds no editable element, and nothing happens.
	test('the bold button wraps the selection without stealing the caret', async ({ page }) => {
		await editor.loadContent('select some of this text\n\nsecond block\n');
		await editor.focusBlock(0, 7);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator(TOOLBAR)).toBeVisible();

		await page.locator('[data-testid="toolbar-format.toggleStrong"]').click();

		await editor.bridge.waitForSourceContains('select **some** of this text');
	});

	test('a wrapped selection hangs the bar where it ends, not off rect[0] or the union', async ({
		page
	}) => {
		const line = 'word '.repeat(120).trim();
		await editor.loadContent(`${line}\n`);
		await editor.focusBlock(0, 40);
		for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');

		const toolbar = page.locator(TOOLBAR);
		await expect(toolbar).toBeVisible();
		const bar = (await toolbar.boundingBox())!;
		const first = (await firstSelectionRect(page))!;
		const last = (await lastSelectionRect(page))!;
		// The range starts mid-line and ends lines below, so rect[0], the last line and the union
		// all have different corners.
		expect(first.left).toBeGreaterThan(50);
		expect(last.top).toBeGreaterThanOrEqual(first.bottom);
		// The bar's corner sits at the last line's end, within the bar's own height of it.
		expect(Math.abs(bar.x - last.right)).toBeLessThan(bar.height);
		expect(Math.abs(bar.y - last.bottom)).toBeLessThan(bar.height);
	});

	test('a cross-block selection anchors below the start block via rangeRects', async ({ page }) => {
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
		expect(bar!.y).toBeGreaterThanOrEqual(blockTop);
	});

	// Miss-analysis: the cross-block row ended in a paragraph, so the table end's fallback to the
	// start block, which put the bar over the selected rows, was never placed.
	test('a cross-block selection ending in a cell hangs the bar off that cell', async ({ page }) => {
		await editor.loadContent('head\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		const cells = page.locator('.table-cell');
		const from = await pointAtRaw(page, [0], 0);
		const to = (await cells.nth(2).boundingBox())!;
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
		await page.mouse.up();
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSelection()?.focus))
			.toEqual({ path: [1], offset: 2, cellCoordinate: true });

		const toolbar = page.locator(TOOLBAR);
		await expect(toolbar).toBeVisible();
		const bar = (await toolbar.boundingBox())!;
		expect(bar.y).toBeGreaterThanOrEqual(to.y + to.height - 1);
		expect(bar.x).toBeGreaterThanOrEqual(to.x + to.width - 1);
		// The selected rows stay pressable: no selected cell's centre is under the bar.
		for (let i = 0; i < 4; i++) {
			const cell = (await cells.nth(i).boundingBox())!;
			const onBar = await page.evaluate(
				({ x, y }) =>
					!!document.elementFromPoint(x, y)?.closest('[data-testid="selection-toolbar"]'),
				{ x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 }
			);
			expect(onBar, `cell ${i}`).toBe(false);
		}
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

	// What the split has to show the user: the toggles stay live because they handle a
	// cross-block range, and only the button that would still be refused looks dead.
	test('a cross-block selection greys only the link editor out', async ({ page }) => {
		await editor.loadContent('first block here\n\nsecond block below\n');
		await editor.focusBlockStart(0);
		await editor.shiftClickBlock([1], 6);
		await editor.waitForCrossBlock(true);

		await expect(page.locator(TOOLBAR)).toBeVisible();
		await expect(page.locator('[data-testid="toolbar-format.toggleStrong"]')).toBeEnabled();
		await expect(page.locator('[data-testid="toolbar-link.openCard"]')).toBeDisabled();
	});

	// The bar paints pressed for a run the click does not act on: nothing inside a bare
	// delimiter, and an outer run that survives stripping the inner one.
	test('the strike button declines over a bare delimiter and splits the outer run over the inner', async ({
		page
	}) => {
		await editor.loadContent('~~a ~b~ c~~\n');
		const strike = page.locator('[data-testid="toolbar-format.toggleStrikethrough"]');

		await editor.focusBlock(0, 4);
		await page.keyboard.press('Shift+ArrowRight');
		await expect(strike).toHaveAttribute('aria-pressed', 'true');
		await strike.click();

		// A toolbar button click, not a keystroke.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('~~a ~b~ c~~\n');
		expect(await editor.bridge.getSelectionPaths()).toMatchObject({
			anchor: { offset: 4 },
			focus: { offset: 5 }
		});
		await expect(strike).toHaveAttribute('aria-pressed', 'true');

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

	// A heading level belongs to one block, so the command declines over a range and the row goes
	// with it; the rows that do act on the whole range stay.
	test('a cross-block selection drops the Set heading row, a single-block one keeps it', async ({
		page
	}) => {
		await editor.loadContent('first block here\n\nsecond block below\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press(extendKey('docEnd'));
		await editor.waitForCrossBlock(true);

		await expect(page.locator(TOOLBAR)).toBeVisible();
		await expect(page.locator('[data-testid="toolbar-set-heading"]')).toHaveCount(0);

		await page.keyboard.press('ArrowLeft');
		await editor.waitForCrossBlock(false);
		await editor.focusBlock(0, 3);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');

		await expect(page.locator(TOOLBAR)).toBeVisible();
		await expect(page.locator('[data-testid="toolbar-set-heading"]')).toBeVisible();
	});

	// This row stays where the heading picker goes, because it does handle a cross-block range:
	// each block's covered run becomes its own code span.
	test('the inline code row over a cross-block selection wraps each block on its own', async ({
		page
	}) => {
		await editor.loadContent('first block\n\nsecond block\n');
		await editor.focusBlock(0, 3);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		await page.locator('[data-testid="toolbar-format.toggleCode"]').click();
		await editor.bridge.waitForSourceEquals('`first block`\n\n`second block`\n', 3000);
	});

	// The editor's own menu takes the selection's spot: two cards over one range read as a glitch.
	test('the bar hides while the editor menu is open and returns when it closes', async ({
		page
	}) => {
		await editor.loadContent('select some of this text\n\nsecond block\n');
		await editor.focusBlock(0, 7);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator(TOOLBAR)).toBeVisible();

		// A right-click inside the selection opens the clipboard menu over it.
		const rect = (await firstSelectionRect(page))!;
		await page.mouse.click(rect.left + 2, (rect.top + rect.bottom) / 2, { button: 'right' });
		await expect(page.getByRole('menu', { name: 'Block actions' })).toBeVisible();
		await expect(page.locator(TOOLBAR)).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
		await expect(page.locator(TOOLBAR)).toBeVisible();
	});

	// `runCommand` with an argument: the picker runs `heading.cycle` with the level it was given.
	test('Set heading runs heading.cycle with the picked level, and Normal text with zero', async ({
		page
	}) => {
		await editor.loadContent('select some of this text\n\nsecond block\n');
		await editor.focusBlock(0, 7);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator(TOOLBAR)).toBeVisible();

		// The picker opens on hover, the way a menu's flyout does.
		await page.locator('[data-testid="toolbar-set-heading"]').hover();
		await page.locator('[data-testid="toolbar-set-heading-2"]').click();
		await editor.bridge.waitForSourceEquals('## select some of this text\n\nsecond block\n');

		await editor.focusBlock(0, 10);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator(TOOLBAR)).toBeVisible();
		await page.locator('[data-testid="toolbar-set-heading"]').hover();
		await page.locator('[data-testid="toolbar-set-heading-0"]').click();
		await editor.bridge.waitForSourceEquals('select some of this text\n\nsecond block\n');
	});
});

test.describe('selection toolbar in live mode', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
	});

	// The link editor is not a mark, so its pressed state is the construct the card would edit.
	// Live mode alone: every other mode paints the destination and the chord opens nothing.
	test('the link button paints pressed inside a link and unpressed outside it', async ({
		page
	}) => {
		// The link spans raw [6, 36); `linked words` is its text and ` after` follows.
		await editor.loadContent('plain [linked words](https://x.test) after\n');
		await editor.focusBlockAtPath([0], 8);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');

		const link = page.locator('[data-testid="toolbar-link.openCard"]');
		await expect(page.locator(TOOLBAR)).toBeVisible();
		await expect(link).toHaveAttribute('aria-pressed', 'true');

		await editor.focusBlockAtPath([0], 0);
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(link).toHaveAttribute('aria-pressed', 'false');

		// What the pressed state promises: clicking over the same range opens that link's own card.
		await editor.focusBlockAtPath([0], 8);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(link).toHaveAttribute('aria-pressed', 'true');
		await link.click();

		await expect(page.locator('[data-link-card]')).toBeVisible();
		await expect(page.locator('[data-link-card] input[aria-label="Link URL"]')).toHaveValue(
			'https://x.test'
		);
		await expect(page.locator('[data-link-card] input[aria-label="Link URL"]')).toBeFocused();
	});
});

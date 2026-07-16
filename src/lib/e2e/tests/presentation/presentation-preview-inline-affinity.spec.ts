import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';

// The caret-affinity contract, verified as shipped: the caret is a raw offset, a
// revealed construct's bytes are visible, and typing lands at that offset — no
// stored-marks machinery. Distinct from presentation-preview-inline-editing.spec.ts
// (mid-construct typing, marker-text typing, dissolve).
// Requirements: e2e/requirements/presentation/presentation-preview-inline-affinity.md.

const togglePreviewInline = (page: Page) => page.getByTestId('preview-inline-toggle').click();

async function focusOffset(ep: EditorPage): Promise<number> {
	return (await ep.bridge.getSelectionPaths())?.focus.offset ?? -1;
}

// Real keyboard walk to a target raw offset (a click can't target hidden markers).
// Asserts the exact landing so a skipped byte fails loudly rather than typing blind.
async function stepRightTo(ep: EditorPage, page: Page, target: number): Promise<void> {
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();
	let offset = await focusOffset(ep);
	while (offset < target) {
		await page.keyboard.press('ArrowRight');
		await ep.waitForRenderFlush();
		offset = await focusOffset(ep);
	}
	expect(offset).toBe(target);
}

test.describe('preview-inline — caret affinity', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
	});

	async function load(doc: string, page: Page): Promise<void> {
		await ep.loadContent(doc);
		await togglePreviewInline(page);
	}

	test('adjacent constructs share a boundary: both reveal, typing inserts between them', async ({
		page
	}) => {
		// "q **a***b* q": strong [2,7), emphasis [7,10). Shared raw boundary at 7.
		await load('q **a***b* q\n', page);
		await ep.clickBlock(0);
		await stepRightTo(ep, page, 7);
		await expect(ep.getBlock(0).locator('[data-construct-start="2"]').first()).toBeVisible();
		await expect(ep.getBlock(0).locator('[data-construct-start="7"]').first()).toBeVisible();

		await page.keyboard.type('X');
		// Byte lands at raw 7 — between the two constructs, splitting neither.
		await ep.bridge.waitForSourceContains('q **a**X*b* q');
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('typing just past a closing marker lands after the marker bytes', async ({ page }) => {
		// "alpha **beta**": strong [6,14). Offset 14 is the trailing edge (block end).
		await load('alpha **beta**\n', page);
		await ep.clickBlock(0);
		await stepRightTo(ep, page, 14);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('alpha **beta**X');
	});

	test('the block-leading opening markers are reachable and typing lands before them', async ({
		page
	}) => {
		await load('**bold** here\n', page);
		await ep.clickBlock(0);
		// Home lands at the first VISIBLE position (after the folded opening `**`); step
		// right into the content, then walk LEFT to reach raw offset 0.
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight'); // now inside "bold", markers revealed
		let offset = await focusOffset(ep);
		let guard = 0;
		while (offset > 0 && guard++ < 20) {
			await page.keyboard.press('ArrowLeft');
			await ep.waitForRenderFlush();
			offset = await focusOffset(ep);
		}
		expect(offset).toBe(0);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('X**bold** here');
	});

	test('fold-then-type lands the byte at the visible caret, never inside hidden markers', async ({
		page
	}) => {
		// "**bold** tail": strong [0,8). Reveal inside, then leave into "tail" so the
		// construct folds, and type immediately at the folded boundary.
		await load('**bold** tail\n', page);
		await ep.clickBlock(0);
		await stepRightTo(ep, page, 4); // inside — revealed
		await expect(ep.getBlock(0).locator('[data-construct-start="0"]').first()).toBeVisible();

		await stepRightTo(ep, page, 9); // into "tail" — folds
		await expect(ep.getBlock(0).locator('[data-construct-start="0"]').first()).toBeHidden();

		await page.keyboard.type('X');
		// Raw 9 is between the space and 't' — the byte lands where the caret showed.
		await ep.bridge.waitForSourceContains('**bold** Xtail');
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});
});

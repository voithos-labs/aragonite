import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { focusOffset } from './helpers';

// The caret-affinity rule: the caret is a raw offset, a shown construct's bytes are visible,
// and typing lands at that offset, with no stored-marks machinery.
// Requirements: e2e/requirements/presentation/presentation-preview-inline-affinity.md.

const togglePreviewInline = (page: Page) => page.getByTestId('preview-inline-toggle').click();

// Step to a target raw offset with real keys, since a click cannot target hidden markers.
// Asserts the exact landing so a skipped byte fails loudly rather than typing blind.
async function stepRightTo(ep: EditorPage, page: Page, target: number): Promise<void> {
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();
	let offset = await focusOffset(ep);
	let guard = 0;
	while (offset < target && guard++ < 40) {
		await page.keyboard.press('ArrowRight');
		await ep.waitForRenderFlush();
		offset = await focusOffset(ep);
	}
	expect(offset).toBe(target);
}

test.describe('preview-inline: caret affinity', () => {
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
		// The byte lands at raw 7: between the two constructs, splitting neither.
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
		// Home lands at the first visible position, after the hidden opening `**`; step right
		// into the content, then step left to reach raw offset 0.
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight'); // now inside "bold", markers shown
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
		// "**bold** tail": strong [0,8). Show it from inside, then leave into "tail" so it hides
		// again, and type immediately at that boundary.
		await load('**bold** tail\n', page);
		await ep.clickBlock(0);
		await stepRightTo(ep, page, 4); // inside, so the markers show
		await expect(ep.getBlock(0).locator('[data-construct-start="0"]').first()).toBeVisible();

		await stepRightTo(ep, page, 9); // into "tail", so they hide
		await expect(ep.getBlock(0).locator('[data-construct-start="0"]').first()).toBeHidden();

		await page.keyboard.type('X');
		// Raw 9 is between the space and 't': the byte lands where the caret showed.
		await ep.bridge.waitForSourceContains('**bold** Xtail');
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});
});

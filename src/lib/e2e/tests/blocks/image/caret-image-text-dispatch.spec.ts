import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

async function setupStaleInlineParagraph(editor: EditorPage, page: Page): Promise<void> {
	await editor.loadContent('text1\n\n![pic](/test-fixtures/sample.png)\n\ntext2\n');
	await waitForFirstImageLoaded(page);
	// Click-based placement: a programmatic element-level caret bypasses the snap state the
	// intercept needs.
	const widget = page.locator('[data-image-widget]').first();
	const widgetBox = await widget.boundingBox();
	if (!widgetBox) throw new Error('widget box missing');
	await page.mouse.click(widgetBox.x + widgetBox.width + 30, widgetBox.y + widgetBox.height / 2);
	await page.keyboard.press('a');
	await editor.bridge.waitForSourceContains(')a');
	await editor.focusBlockStart(2);
}

async function waitForFocusedTopLevelBlock(page: Page, index: number): Promise<void> {
	await page.waitForFunction((expected) => {
		const sel = (
			window as unknown as {
				__test: { getSelectionPaths: () => { anchor: { path: number[] } } | null };
			}
		).__test.getSelectionPaths();
		return sel?.anchor.path[0] === expected;
	}, index);
}

test.describe('caret dispatch around image+text paragraphs', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('after typing trailing text, ArrowUp from the next paragraph lands in the image+text paragraph (not "text1")', async ({
		page
	}) => {
		await setupStaleInlineParagraph(editor, page);
		await page.keyboard.press('ArrowUp');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/!\[pic\]\([^)]+\)Xa|!\[pic\]\([^)]+\)aX/);
		expect(src).not.toMatch(/text1X|Xtext1/);
	});

	test('after typing trailing text, ArrowLeft from the next paragraph lands the caret after the typed text', async ({
		page
	}) => {
		await setupStaleInlineParagraph(editor, page);
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/!\[pic\]\([^)]+\)aX/);
	});

	test('Down from text1 lands a visible caret on the trailing-text line of the image+text paragraph', async ({
		page
	}) => {
		await setupStaleInlineParagraph(editor, page);
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await waitForFocusedTopLevelBlock(page, 0);
		await page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/!\[pic\]\([^)]+\)aX|!\[pic\]\([^)]+\)Xa/);
		expect(src).not.toMatch(/!\[Xpic|Xtext1|text1X/);
	});

	test('Down/Down from text1 reaches text2 in two presses (image visual line is transparent)', async ({
		page
	}) => {
		await setupStaleInlineParagraph(editor, page);
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await waitForFocusedTopLevelBlock(page, 0);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/text2|Xtext2|teXxt2|texXt2|textX2|text2X/);
		expect(src).not.toMatch(/!\[pic\]\([^)]+\)aX|!\[pic\]\([^)]+\)Xa/);
	});
});

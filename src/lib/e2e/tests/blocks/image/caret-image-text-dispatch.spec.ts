import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

// The image carries a box and the trailing text several words, so a landing at the image's
// leading edge and one in the text are different bytes and a good many pixels apart.
// Requirements: `e2e/requirements/blocks/image/caret-image-text-dispatch.md`.

const IMAGE = '![pic|120x80](/test-fixtures/sample.png)';
const TRAILING = 'alpha beta gamma';

async function setupStaleInlineParagraph(editor: EditorPage, page: Page): Promise<void> {
	await editor.loadContent(`text1\n\n${IMAGE}\n\ntext2\n`);
	await waitForFirstImageLoaded(page);
	// Click-based placement: a programmatic element-level caret bypasses the snap state the
	// intercept needs.
	const widget = page.locator('[data-image-widget]').first();
	const widgetBox = await widget.boundingBox();
	if (!widgetBox) throw new Error('widget box missing');
	await page.mouse.click(widgetBox.x + widgetBox.width + 30, widgetBox.y + widgetBox.height / 2);
	// Key by key: the caret sits at the image's edge, where the block's own keydown places the
	// byte and `insertText` would land nothing.
	await editor.typeSlowly(TRAILING);
	await editor.bridge.waitForSourceContains(`)${TRAILING}`);
	await editor.focusBlockStart(2);
}

/** Where the typed character landed inside the paragraph's trailing text, and -1 when it landed
 *  anywhere else: the read that tells a landing in the text from one at the image's leading
 *  edge, where nothing paints a caret. */
function typedIndexInTrailingText(src: string): number {
	const trailing = /!\[pic\|120x80\]\([^)]+\)([^\n]*)/.exec(src)?.[1] ?? '';
	return trailing.replace('X', '') === TRAILING ? trailing.indexOf('X') : -1;
}

async function focusStartOfText1(editor: EditorPage, page: Page): Promise<void> {
	await page.locator('[contenteditable="true"]').nth(0).click();
	await page.keyboard.press('Home');
	await editor.waitForRenderFlush();
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
		expect(typedIndexInTrailingText(src)).toBeGreaterThanOrEqual(0);
		expect(src).not.toMatch(/text1X|Xtext1/);
	});

	test('after typing trailing text, ArrowLeft from the next paragraph lands the caret after the typed text', async ({
		page
	}) => {
		await setupStaleInlineParagraph(editor, page);
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
		await editor.typeText('X');
		expect(await editor.bridge.getSource()).toContain(`)${TRAILING}X`);
	});

	test('Down from text1 lands a visible caret on the trailing-text line of the image+text paragraph', async ({
		page
	}) => {
		await setupStaleInlineParagraph(editor, page);
		// From the start of the line above, so the column sits left of the image: the nearest
		// position of all is the image's leading edge, and the caret has to land in the text anyway.
		await focusStartOfText1(editor, page);
		await page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(typedIndexInTrailingText(src)).toBeGreaterThanOrEqual(0);
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
		expect(typedIndexInTrailingText(src)).toBe(-1);
	});
});

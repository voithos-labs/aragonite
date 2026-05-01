import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// Document order: text "before". image. text "after". When the image is
// standalone, paragraphs B-1, B, B+1 are three separate top-level blocks.
const STANDALONE_IMAGE_DOC =
	'before paragraph.\n\n![pic](/test-fixtures/sample.png)\n\nafter paragraph.\n';

const INLINE_IMAGE_DOC = 'lead text ![pic](/test-fixtures/sample.png) trail text\n';

const LIST_IMAGE_DOC =
	'above list paragraph.\n\n- ![pic](/test-fixtures/sample.png)\n- second item text\n';

test.describe('caret traversal around image widgets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Bug 1 regression: caret stuck inside image-only first list item.
	test('ArrowUp from a list item below an image-only list item skips out of the list', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await editor.focusBlockAtPath([1, 1, 0], 0);
		await page.keyboard.press('ArrowUp');
		// Type a marker; it must land in the "above list paragraph" line, not
		// in the image's list-item content.
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*above list paragraph|above list paragraph.*X|abXove|abovXe/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	// Bug B regression — Up: caret invisible while landing at the image-only
	// paragraph. Vertical-skip resolves it to a one-press jump.
	test('ArrowUp from below a standalone image skips the image paragraph in one press', async ({
		page
	}) => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockStart(2);
		await page.keyboard.press('ArrowUp');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		// X must land in the "before" paragraph, never inside the image source.
		expect(src).toMatch(/X.*before paragraph|before.*paragraphX/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	test('ArrowDown from above a standalone image skips the image paragraph in one press', async ({
		page
	}) => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*after paragraph|after paragraph.*X/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	// Bug B regression — Left: 4-press flow with two invisible steps. Now
	// 2 presses: select widget, then caret at end of paragraph above.
	test('ArrowLeft from below a standalone image: press 1 selects, press 2 lands above', async ({
		page
	}) => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockStart(2);
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toContain('before paragraph.X');
	});

	test('ArrowRight from above a standalone image: press 1 selects, press 2 lands below', async ({
		page
	}) => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toContain('Xafter paragraph');
	});

	// Bug A reference: 2 presses for inline-image Left works the same way
	// (text both before and after the image in the same paragraph).
	test('ArrowLeft from after an inline image: select then land at end of preceding text', async ({
		page
	}) => {
		await editor.loadContent(INLINE_IMAGE_DOC);
		await page.evaluate(() => {
			const w = document.querySelector('[data-image-widget]');
			if (!w) throw new Error('widget not found');
			const para = w.closest('[contenteditable="true"]') as HTMLElement;
			para.focus();
			const range = document.createRange();
			const parent = w.parentNode!;
			const idx = Array.prototype.indexOf.call(parent.childNodes, w);
			range.setStart(parent, idx + 1);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
		});
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		// X lands immediately before the image; trailing whitespace from
		// "lead text " may sit on either side depending on offset choice.
		expect(src).toMatch(/lead text\s*X\s*!\[pic\]/);
	});

	// Cursor-trap regression: the hidden source span used to attract the
	// caret on cross-block focusAtColumn. Verify the caret lands at a
	// visible widget edge rather than inside the source span.
	test('cross-block ArrowUp landing on standalone image leaves a visible caret', async ({
		page
	}) => {
		await editor.loadContent(
			'first paragraph text.\n\n![pic|400x200](/test-fixtures/sample.png)\n'
		);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowDown');
		// One ArrowDown should reach the image paragraph. Image paragraphs are
		// vertically-transparent, so we move PAST it — but if there's nothing
		// past it (last block), creating a new paragraph is acceptable.
		await page.keyboard.press('ArrowUp');
		// We're back at first paragraph; the test's real assertion is that no
		// step left a caret inside the widget's hidden source span — verified
		// by typing and confirming the resulting source.
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		// The X must appear in actual text, not as a malformed splice into the
		// image source bytes.
		expect(src).not.toMatch(/!\[.*X.*\]/);
		expect(src).not.toMatch(/X.*\(\/test-fixtures/);
	});
});

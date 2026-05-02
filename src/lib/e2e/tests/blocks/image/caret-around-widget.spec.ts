import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// Document order: text "before". image. text "after". When the image is
// standalone, paragraphs B-1, B, B+1 are three separate top-level blocks.
const STANDALONE_IMAGE_DOC =
	'before paragraph.\n\n![pic](/test-fixtures/sample.png)\n\nafter paragraph.\n';

const INLINE_IMAGE_DOC = 'lead text ![pic](/test-fixtures/sample.png) trail text\n';

const LIST_IMAGE_DOC =
	'above list paragraph.\n\n- ![pic](/test-fixtures/sample.png)\n- second item text\n';

const LIST_IMAGE_LAST_DOC =
	'- first item text\n- ![pic](/test-fixtures/sample.png)\n\nbelow list paragraph.\n';

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

	// Inverse regression: ArrowDown into a list whose first item is image-only
	// must skip the transparent item and land on the next text-bearing item.
	test('ArrowDown from above an image-only-first list-item lands in the second item', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*second item text|second item text.*X|seconXd|secondX item/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	// Symmetric: ArrowUp into a list whose last item is image-only must skip
	// the transparent item and land on the preceding text-bearing item.
	test('ArrowUp from below an image-only-last list-item lands in the penultimate item', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_LAST_DOC);
		await editor.focusBlockStart(1);
		await page.keyboard.press('ArrowUp');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*first item text|first item text.*X|firXst|firstX item/);
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

	// ── Click-to-edge snap (Notion-style) ───────────────────────────────

	async function getCursorRawInActiveCE(page: import('@playwright/test').Page): Promise<number | null> {
		return page.evaluate(() => {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return null;
			const r = sel.getRangeAt(0);
			const ce = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
			if (!ce || !ce.contains(r.startContainer)) return null;
			let count = 0;
			let stopped = false;
			function visit(current: Node): void {
				if (stopped) return;
				if (current === r!.startContainer) {
					if (current.nodeType === Node.TEXT_NODE) {
						count += r!.startOffset;
					} else {
						const cap = Math.min(r!.startOffset, current.childNodes.length);
						for (let i = 0; i < cap; i++) visit(current.childNodes[i]);
					}
					stopped = true;
					return;
				}
				if (current.nodeType === Node.TEXT_NODE) {
					count += current.textContent?.length ?? 0;
					return;
				}
				if (current.nodeType === Node.ELEMENT_NODE) {
					const el = current as Element;
					if (el.matches?.('[data-image-widget]')) {
						const s = parseInt(el.getAttribute('data-source-start') ?? '', 10);
						const e = parseInt(el.getAttribute('data-source-end') ?? '', 10);
						if (!isNaN(s) && !isNaN(e)) count += e - s;
						return;
					}
					if (el.matches?.('.md-marker')) return;
					for (const child of current.childNodes) visit(child);
				}
			}
			visit(ce);
			return count;
		});
	}

	test('click right of an image-only list item lands the cursor at image.end', async ({
		page
	}) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)\n');
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		const widget = page.locator('[data-image-widget]').first();
		const para = widget.locator('xpath=ancestor::*[@contenteditable="true"]');
		const widgetBox = await widget.boundingBox();
		const paraBox = await para.boundingBox();
		if (!widgetBox || !paraBox) throw new Error('layout boxes missing');
		const clickX = Math.min(widgetBox.x + widgetBox.width + 80, paraBox.x + paraBox.width - 20);
		await page.mouse.click(clickX, widgetBox.y + widgetBox.height / 2);
		expect(await getCursorRawInActiveCE(page)).toBe(41);
	});

	test('click left of an image-only list item lands the cursor at image.start', async ({
		page
	}) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)\n');
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		const widget = page.locator('[data-image-widget]').first();
		const widgetBox = await widget.boundingBox();
		if (!widgetBox) throw new Error('widget box missing');
		await page.mouse.click(widgetBox.x - 8, widgetBox.y + widgetBox.height / 2);
		expect(await getCursorRawInActiveCE(page)).toBe(0);
	});
});

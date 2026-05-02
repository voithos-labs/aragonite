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

	// Regression: typing at the start of a wrapped line *after* an inline
	// image used to teleport the caret. Chromium parks the caret at offset
	// = image.end when clicking at the wrap boundary; the snap-fallback
	// keydown intercept misfired and routed typing through the CST when
	// Chromium could have inserted natively. The fix narrows the intercept
	// to the "Chromium dropped the caret" case only.
	test('typing at the wrap boundary after an inline image inserts natively (no teleport)', async ({
		page
	}) => {
		await editor.loadContent(
			'Lorem ipsum dolor sit amet ![inline](/test-fixtures/sample.png) consectetur.\n'
		);
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		// Place the caret immediately before the leading space of " consectetur"
		// — i.e., right after the image's source bytes. This is the position
		// Chromium picks when the user clicks at the start of the wrapped line.
		await page.evaluate(() => {
			const w = document.querySelector('[data-image-widget]') as HTMLElement;
			const para = w.closest('[contenteditable="true"]') as HTMLElement;
			para.focus();
			// Walk to the text node that immediately follows the widget.
			let next: Node | null = w.nextSibling;
			while (next && next.nodeType !== Node.TEXT_NODE) next = next.nextSibling;
			if (!next) throw new Error('no text node after widget');
			const range = document.createRange();
			range.setStart(next, 0);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
		});
		await page.keyboard.press('a');
		await page.keyboard.press('b');
		const src = await editor.bridge.getSource();
		// Both `a` and `b` must land contiguously immediately after the
		// image's source bytes. Pre-fix bug: first `a` lands correctly via
		// the CST intercept, but pendingCursorOffset is unset so the caret
		// falls back to the start of the contenteditable; the second `b`
		// then either teleports to the start of the paragraph or routes
		// through Chromium native into a wrong position.
		expect(src).toMatch(/!\[inline\]\(\/test-fixtures\/sample\.png\)ab /);
		expect(src.startsWith('Lorem')).toBe(true);
	});

	test('snap-target widget shows a synthetic caret on the right edge', async ({ page }) => {
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
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);

		const overlay = await page.evaluate(() => {
			const w = document.querySelector('[data-image-widget].md-snap-after') as HTMLElement;
			if (!w) return null;
			const before = window.getComputedStyle(w, '::before');
			return {
				content: before.content,
				position: before.position,
				bg: before.backgroundColor,
				width: before.width
			};
		});
		expect(overlay).not.toBeNull();
		expect(overlay!.content).not.toBe('none');
		expect(overlay!.position).toBe('absolute');
		// width is set to 1.5px; Chromium reports rounded — accept the line being thin.
		expect(parseFloat(overlay!.width)).toBeLessThan(4);
	});

	// Synthetic indicator is a fallback for "native caret can't render" — it
	// appears only when the cursor is at a widget boundary AT ELEMENT-LEVEL
	// (no text-node anchor) or when Chromium dropped the caret entirely. In
	// any state where native caret renders (cursor in a text node), the
	// synthetic stays absent so the two indicators don't compete.

	test('arrow-left into a widget boundary in trailing text does not show synthetic', async ({
		page
	}) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)a\n');
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		await page.evaluate(() => {
			const ce = document.querySelector('[contenteditable="true"]') as HTMLElement;
			ce.focus();
			const w = ce.querySelector('[data-image-widget]') as HTMLElement;
			const trailing = w.nextSibling as Text;
			const range = document.createRange();
			range.setStart(trailing, trailing.textContent!.length);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
		});
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
		await expect(page.locator('[data-image-widget].md-snap-before')).toHaveCount(0);
	});

	test('click that lands cursor in trailing text does not show synthetic', async ({ page }) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)abcdef\n');
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		const widget = page.locator('[data-image-widget]').first();
		const widgetBox = await widget.boundingBox();
		if (!widgetBox) throw new Error();
		await page.mouse.click(widgetBox.x + widgetBox.width + 4, widgetBox.y + widgetBox.height / 2);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
	});

	test('synthetic appears after Enter splits paragraph and clicking image-only block', async ({
		page
	}) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)a\n');
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		await page.evaluate(() => {
			const ce = document.querySelector('[contenteditable="true"]') as HTMLElement;
			ce.focus();
			const w = ce.querySelector('[data-image-widget]') as HTMLElement;
			const trailing = w.nextSibling as Text;
			const range = document.createRange();
			range.setStart(trailing, 0);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
		});
		await page.keyboard.press('Enter');
		const widget = page.locator('[data-image-widget]').first();
		const para = widget.locator('xpath=ancestor::*[@contenteditable="true"]');
		const widgetBox = await widget.boundingBox();
		const paraBox = await para.boundingBox();
		if (!widgetBox || !paraBox) throw new Error();
		const clickX = Math.min(widgetBox.x + widgetBox.width + 80, paraBox.x + paraBox.width - 20);
		await page.mouse.click(clickX, widgetBox.y + widgetBox.height / 2);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);
	});

	test('synthetic caret clears after the first typed character', async ({ page }) => {
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
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);
		await page.keyboard.press('a');
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
	});

	test('synthetic caret clears when clicking into a different paragraph', async ({ page }) => {
		await editor.loadContent(
			'- ![pic|300x200](/test-fixtures/sample.png)\n\nfollowing paragraph.\n'
		);
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
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);

		// Click into the second paragraph — focus leaves the image-only block.
		const followingPara = page.locator('[contenteditable="true"]').nth(1);
		await followingPara.click();
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
	});

	test('synthetic caret clears when arrow keys move the caret away', async ({ page }) => {
		await editor.loadContent(
			'lead text ![pic|240x180](/test-fixtures/sample.png) trail text\n'
		);
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		// Force a snap by clicking past the widget's right edge inside the paragraph.
		const widget = page.locator('[data-image-widget]').first();
		const widgetBox = await widget.boundingBox();
		if (!widgetBox) throw new Error();
		// Clicks within the trailing text region — but use programmatic
		// snap-trigger so we don't depend on layout details.
		await page.evaluate(() => {
			const ce = document.querySelector('[contenteditable="true"]') as HTMLElement;
			ce.focus();
			// Simulate the snap state: caret element-level + lastSnapTargetOffset.
			// We mimic by clicking the widget's right edge.
		});
		await page.mouse.click(widgetBox.x + widgetBox.width + 1, widgetBox.y + widgetBox.height / 2);
		// Either snap class or live caret in trailing text — both are valid
		// post-click states. Move caret with arrow key and assert no
		// snap-class persists afterwards.
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-inline-widget].md-snap-after')).toHaveCount(0);
		await expect(page.locator('[data-inline-widget].md-snap-before')).toHaveCount(0);
	});

	// Regression: typing twice after click-snap used to put the second char
	// before the image. Cause was `pendingCursorOffset` not being restored
	// after the snap-fallback intercept's CST update — Svelte re-rendered
	// without restoring the caret, leaving it at the contenteditable's
	// element-level offset 0. The next keystroke matched offset 0 against
	// image.start and inserted the character at the start of the paragraph.
	test('typing twice after click-snap appends to the same position (no caret jump)', async ({
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
		await page.keyboard.press('a');
		await page.keyboard.press('b');
		const src = await editor.bridge.getSource();
		// Both characters must land contiguously after the image source.
		expect(src).toContain(')ab');
		// And nothing should have been inserted before the image source.
		expect(src.startsWith('- !')).toBe(true);
	});

	// Regression for the real-browser shape of the click-snap typing bug.
	// Chromium often preserves the live caret at the element-level position
	// the snap installed (parent + idx-after-widget), unlike Playwright
	// which drops it entirely. cursor.getRaw() then returns image.end but
	// startContainer is the paragraph element, not a text node — Chromium
	// silently drops printable-key insertions at that position. The
	// keydown intercept must fire even when liveCursor is non-null, gated
	// on whether the caret sits in a real text node.
	test('typing inserts after image even when caret is preserved at element-level', async ({
		page
	}) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)\n');
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		// Programmatically install the real-Chromium snap-state shape:
		// caret at the contenteditable's element-level offset immediately
		// after the widget, plus the editor's own snap-target offset.
		await page.evaluate(() => {
			const ce = document.querySelector('[contenteditable="true"]') as HTMLElement;
			ce.focus();
			const widget = ce.querySelector('[data-image-widget]') as HTMLElement;
			const parent = widget.parentNode!;
			const idx = Array.prototype.indexOf.call(parent.childNodes, widget);
			const range = document.createRange();
			range.setStart(parent, idx + 1);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
			// Click the widget's right edge to populate the editor's
			// `lastSnapTargetOffset` and then re-pin the cursor at element
			// level. (mouse.click sets it; we then overwrite the selection
			// to the canonical real-Chromium shape.)
		});
		const widget = page.locator('[data-image-widget]').first();
		const widgetBox = await widget.boundingBox();
		if (!widgetBox) throw new Error();
		await page.mouse.click(widgetBox.x + widgetBox.width + 30, widgetBox.y + widgetBox.height / 2);
		// Re-install the element-level caret (mouse.click might have left
		// it text-node-anchored or null depending on layout).
		await page.evaluate(() => {
			const ce = document.querySelector('[contenteditable="true"]') as HTMLElement;
			const widget = ce.querySelector('[data-image-widget]') as HTMLElement;
			const parent = widget.parentNode!;
			const idx = Array.prototype.indexOf.call(parent.childNodes, widget);
			const range = document.createRange();
			range.setStart(parent, idx + 1);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
		});
		await page.keyboard.press('z');
		const src = await editor.bridge.getSource();
		expect(src).toContain(')z');
	});

	// Regression: with the caret parked at image.end (between widget and end of
	// contenteditable), Chromium silently drops printable-key insertions when
	// the caret sits between contenteditable=false neighbors — neither
	// `beforeinput` nor `input` fires. The keydown branch in TextEditableBlock
	// detects "caret at widget boundary" and routes the character through the
	// CST instead of relying on the browser default. Test uses
	// `keyboard.press` (not `insertText`) because production-bug repro
	// requires keydown to fire.
	test('typing after click-snap to image.end inserts the character into the source', async ({
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
		await page.keyboard.press('X');
		const src = await editor.bridge.getSource();
		// Image source ends at offset 41; the typed X must land immediately
		// after, not be silently dropped.
		expect(src).toContain(')X');
	});
});

import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n';

async function waitForFirstImageLoaded(page: Page): Promise<void> {
	await page.waitForFunction(
		() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
	);
}

async function clickPastImageRightEdge(page: Page): Promise<void> {
	const widget = page.locator('[data-image-widget]').first();
	const para = widget.locator('xpath=ancestor::*[@contenteditable="true"]');
	const widgetBox = await widget.boundingBox();
	const paraBox = await para.boundingBox();
	if (!widgetBox || !paraBox) throw new Error('layout boxes missing');
	const clickX = Math.min(widgetBox.x + widgetBox.width + 80, paraBox.x + paraBox.width - 20);
	await page.mouse.click(clickX, widgetBox.y + widgetBox.height / 2);
}

test.describe('typing and paste after click-snap', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
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
		await waitForFirstImageLoaded(page);
		// Place the caret immediately before the leading space of " consectetur"
		// — i.e., right after the image's source bytes. This is the position
		// Chromium picks when the user clicks at the start of the wrapped line.
		await page.evaluate(() => {
			const w = document.querySelector('[data-image-widget]') as HTMLElement;
			const para = w.closest('[contenteditable="true"]') as HTMLElement;
			para.focus();
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
		// image's source bytes.
		expect(src).toMatch(/!\[inline\]\(\/test-fixtures\/sample\.png\)ab /);
		expect(src.startsWith('Lorem')).toBe(true);
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
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await page.keyboard.press('a');
		await page.keyboard.press('b');
		const src = await editor.bridge.getSource();
		expect(src).toContain(')ab');
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
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
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
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await page.keyboard.press('X');
		const src = await editor.bridge.getSource();
		// Image source ends at offset 41; the typed X must land immediately
		// after, not be silently dropped.
		expect(src).toContain(')X');
	});

	// Pre-fix: keydown's `preEditOffset` re-read `cursor.getRaw()` at the
	// branch site, but the click-snap caret at element-level past the image
	// doesn't survive Chromium's pre-keydown event-loop yield, so getRaw
	// returned null and Shift+Enter inserted the hard break at offset 0 —
	// dragging the image into a continuation line under a `\` first-line.
	test('Shift+Enter at image.end inserts the hard break after the image, not at offset 0', async ({
		page
	}) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)\n- text\n');
		await waitForFirstImageLoaded(page);
		const img = page.locator('[data-image-widget] img').first();
		const ib = await img.boundingBox();
		if (!ib) throw new Error('image missing');
		await page.mouse.click(ib.x + ib.width + 20, ib.y + ib.height / 2);
		await page.keyboard.press('Shift+Enter');
		await editor.bridge.waitForSourceContains(')\\');
		const src = await editor.bridge.getSource();
		// Hard-break marker `\` belongs immediately after the image source,
		// not at the start of the inner paragraph.
		expect(src).toMatch(/!\[pic\|300x200\]\(\/test-fixtures\/sample\.png\)\\/);
		expect(src).not.toMatch(/^- \\\n {2}!/m);
	});

	// Pre-fix: paste read `cursor.getRaw() ?? 0` directly; with the click-snap
	// caret parked at element-level past the image, getRaw returned null and
	// the paste landed at offset 0 of the inner paragraph instead of at the
	// snap target. Closed by routing all callers through cursor's snap-aware
	// getRaw rather than chaining the fallback at every read site.
	test('paste in click-snap state lands at snap target, not offset 0', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		const img = page.locator('[data-image-widget] img').first();
		const ib = await img.boundingBox();
		if (!ib) throw new Error('image missing');
		await page.mouse.click(ib.x + ib.width + 20, ib.y + ib.height / 2);
		// Drop the live range before the paste handler reads it — emulates the
		// Chromium event-loop-yield behaviour where element-level carets past
		// an atomic widget go to rangeCount=0 between keydown and the post-
		// await branch. Then dispatch a synthetic paste; the handler must
		// recover the offset from the snap target.
		await page.evaluate(() => {
			window.getSelection()?.removeAllRanges();
			const dt = new DataTransfer();
			dt.setData('text/plain', 'PASTED');
			const ev = new ClipboardEvent('paste', {
				clipboardData: dt,
				bubbles: true,
				cancelable: true
			});
			(document.querySelector('[data-image-widget]')?.parentElement as HTMLElement).dispatchEvent(
				ev
			);
		});
		await editor.bridge.waitForSourceContains('PASTED');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/\)PASTED/);
		expect(src).not.toMatch(/^- PASTED!/m);
	});
});

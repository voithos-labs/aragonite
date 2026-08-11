import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { clickPastImageRightEdge, waitForFirstImageLoaded } from './helpers';

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n';

test.describe('typing and paste after click-snap', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Chromium parks the caret at image.end when clicking at the wrap boundary, so the
	// snap-fallback keydown intercept must fire only where Chromium dropped the caret — routing
	// typing through the CST here teleports it.
	test('typing at the wrap boundary after an inline image inserts natively (no teleport)', async ({
		page
	}) => {
		await editor.loadContent(
			'Lorem ipsum dolor sit amet ![inline](/test-fixtures/sample.png) consectetur.\n'
		);
		await waitForFirstImageLoaded(page);
		// Right after the image's source bytes, before the leading space of " consectetur" — the
		// position Chromium picks when the user clicks at the start of the wrapped line.
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
		expect(src).toMatch(/!\[inline\]\(\/test-fixtures\/sample\.png\)ab /);
		expect(src.startsWith('Lorem')).toBe(true);
	});

	// `pendingCursorOffset` must be restored after the intercept's CST update: without it the
	// caret falls back to element-level offset 0 and the second char lands before the image.
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

	// Chromium often preserves the live caret at the element-level position the snap installed,
	// unlike Playwright which drops it: getRaw() returns image.end but startContainer is the
	// paragraph element, where Chromium silently drops printable keys. The intercept must fire even
	// when liveCursor is non-null.
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
		// Re-install the element-level caret: mouse.click may leave it text-node-anchored or null.
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

	// With the caret parked at image.end between contenteditable=false neighbors, Chromium drops
	// printable keys silently — neither `beforeinput` nor `input` fires — so keydown routes the
	// char through the CST. `keyboard.press`, not `insertText`: the repro needs keydown.
	test('typing after click-snap to image.end inserts the character into the source', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await page.keyboard.press('X');
		const src = await editor.bridge.getSource();
		// The image source ends at offset 41; X must land immediately after it.
		expect(src).toContain(')X');
	});

	// keydown's `preEditOffset` re-read `cursor.getRaw()` at the branch site, but the click-snap
	// caret does not survive Chromium's pre-keydown yield, so Shift+Enter inserted the break at
	// offset 0.
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
		// The hard-break marker belongs after the image source, not at the start of the inner
		// paragraph.
		expect(src).toMatch(/!\[pic\|300x200\]\(\/test-fixtures\/sample\.png\)\\/);
		expect(src).not.toMatch(/^- \\\n {2}!/m);
	});

	// Every caller must reach raw offsets through the snap-aware getRaw: a bare
	// `cursor.getRaw() ?? 0` reads null on an element-level snap caret and pastes at offset 0.
	test('paste in click-snap state lands at snap target, not offset 0', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		const img = page.locator('[data-image-widget] img').first();
		const ib = await img.boundingBox();
		if (!ib) throw new Error('image missing');
		await page.mouse.click(ib.x + ib.width + 20, ib.y + ib.height / 2);
		// Drop the live range before the paste handler reads it: this emulates Chromium's
		// event-loop yield, where element-level carets past an atomic widget go to rangeCount=0.
		// The handler must recover it from the snap target.
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

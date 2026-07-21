import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n';

async function getCursorRawInActiveCE(page: Page): Promise<number | null> {
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

test.describe('click-to-edge snap landing offset', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('click right of an image-only list item lands the cursor at image.end', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
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
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		const widget = page.locator('[data-image-widget]').first();
		const widgetBox = await widget.boundingBox();
		if (!widgetBox) throw new Error('widget box missing');
		await page.mouse.click(widgetBox.x - 8, widgetBox.y + widgetBox.height / 2);
		expect(await getCursorRawInActiveCE(page)).toBe(0);
	});
});

import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image popover anchoring', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Regression: the popover previously had `position: absolute` with no
	// offsets, sitting at its static-flow position (bottom of `.editor`'s
	// content). For long documents the popover rendered far below the widget,
	// off-screen — invisible to the user even though the test could find it.
	test('popover is anchored just below the widget, not at end of editor flow', async ({ page }) => {
		await editor.loadContent(
			'# heading\n\nfiller paragraph one.\n\nfiller paragraph two.\n\n![cat|200](/test-fixtures/sample.png)\n'
		);
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const popover = page.locator('.md-image-properties').first();
		const widgetBox = await widget.boundingBox();
		const popoverBox = await popover.boundingBox();
		if (!widgetBox || !popoverBox) throw new Error('widget or popover missing');
		const widgetBottom = widgetBox.y + widgetBox.height;
		expect(popoverBox.y).toBeGreaterThan(widgetBottom - 5);
		expect(popoverBox.y).toBeLessThan(widgetBottom + 50);
	});

	// Pre-fix the overlay listened only for ResizeObserver (target widget),
	// `edit` events, and window resize. A sibling image's slow async reload
	// (e.g., the user edits image-1's URL then clicks image-2) reflows the
	// document and shifts the selected widget's y without resizing it; the
	// overlay's anchor was set when image-1 still had its old dimensions and
	// stayed there as image-1 grew, leaving the popover stranded over the
	// wrong image until the next user-driven update.
	test('overlay re-anchors when a sibling image finishes loading and reflows', async ({ page }) => {
		await editor.loadContent(
			'![one|400](/test-fixtures/sample.png)\n\n![two|200](/test-fixtures/sample.png)\n'
		);
		await page.waitForFunction(() =>
			Array.from(document.querySelectorAll('[data-image-widget] img')).every(
				(img) => (img as HTMLImageElement).complete
			)
		);
		const w2Box = await page.locator('[data-image-widget]').nth(1).boundingBox();
		if (!w2Box) throw new Error('w2 box');
		await page.mouse.click(w2Box.x + w2Box.width / 2, w2Box.y + w2Box.height / 2);
		await page.locator('.md-image-properties').waitFor({ state: 'visible' });
		await editor.waitForResizeObserverFlush();

		// Cause a layout shift only image-1 sees (its rendered height grows).
		// Then dispatch the load event — the production fix re-anchors the overlay.
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => {
						const img = document.querySelectorAll('[data-image-widget] img')[0] as HTMLImageElement;
						img.style.height = '400px';
						resolve();
					})
				)
		);
		const stale = await page.evaluate(() => {
			const overlay = document.querySelector('[data-image-overlay]') as HTMLElement;
			const w2 = document.querySelectorAll('[data-image-widget]')[1] as HTMLElement;
			return overlay.getBoundingClientRect().top - w2.getBoundingClientRect().top;
		});
		expect(Math.abs(stale)).toBeGreaterThan(20);

		await page.evaluate(() => {
			const img = document.querySelectorAll('[data-image-widget] img')[0] as HTMLImageElement;
			img.dispatchEvent(new Event('load'));
		});
		await expect
			.poll(async () =>
				Math.abs(
					await page.evaluate(() => {
						const overlay = document.querySelector('[data-image-overlay]') as HTMLElement;
						const w2 = document.querySelectorAll('[data-image-widget]')[1] as HTMLElement;
						return overlay.getBoundingClientRect().top - w2.getBoundingClientRect().top;
					})
				)
			)
			.toBeLessThanOrEqual(1);
	});
});

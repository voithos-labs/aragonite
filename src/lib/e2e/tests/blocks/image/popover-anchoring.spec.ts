import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image popover anchoring', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The popover was `position: absolute` with no offsets, so it sat at its static-flow position
	// at the bottom of `.editor` — in long documents it rendered off-screen while tests could still
	// find it.
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

	// The overlay listened only for ResizeObserver, `edit`, and window resize. A sibling image's
	// slow reload shifts the selected widget's y without resizing it, stranding the popover over
	// the wrong image.
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

		// Shift the layout only image-1 sees, then dispatch its load event: the overlay must
		// re-anchor.
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

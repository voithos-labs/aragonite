import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { waitForAllImagesLoaded } from './helpers';

test.describe('image popover anchoring', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The popover was `position: absolute` with no offsets, so it sat at its static-flow position
	// at the bottom of `.editor` — in long documents it rendered off-screen while tests could still
	// find it. It hangs off the image's right edge, level with its top.
	test('popover sits beside the widget, top-aligned, not at end of editor flow', async ({
		page
	}) => {
		await editor.loadContent(
			'# heading\n\nfiller paragraph one.\n\nfiller paragraph two.\n\n![cat|200](/test-fixtures/sample.png)\n'
		);
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const popover = page.locator('.md-image-properties').first();
		const widgetBox = await widget.boundingBox();
		const popoverBox = await popover.boundingBox();
		if (!widgetBox || !popoverBox) throw new Error('widget or popover missing');
		expect(Math.abs(popoverBox.y - widgetBox.y)).toBeLessThanOrEqual(2);
		expect(popoverBox.x).toBeGreaterThan(widgetBox.x + widgetBox.width);
		expect(popoverBox.x).toBeLessThan(widgetBox.x + widgetBox.width + 24);
	});

	// A full-width image leaves no room beside it; the panel tucks into the image's top-right
	// corner rather than hanging off the viewport.
	test('popover tucks inside a full-width widget', async ({ page }) => {
		// Wider than the column AND the viewport: the tuck must clamp to what is on screen.
		await page.setViewportSize({ width: 640, height: 720 });
		await editor.loadContent('![wide|900](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const popover = page.locator('.md-image-properties').first();
		const widgetBox = (await widget.boundingBox())!;
		const popoverBox = (await popover.boundingBox())!;
		const viewport = page.viewportSize()!;
		await expect(popover).toHaveClass(/inside/);
		expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(viewport.width);
		expect(popoverBox.x).toBeGreaterThanOrEqual(widgetBox.x);
		expect(popoverBox.y).toBeGreaterThanOrEqual(widgetBox.y);
	});

	// The overlay listened only for ResizeObserver, `edit`, and window resize. A sibling image's
	// slow reload shifts the selected widget's y without resizing it, stranding the popover over
	// the wrong image.
	test('overlay re-anchors when a sibling image finishes loading and reflows', async ({ page }) => {
		await editor.loadContent(
			'![one|400](/test-fixtures/sample.png)\n\n![two|200](/test-fixtures/sample.png)\n'
		);
		await waitForAllImagesLoaded(page);
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

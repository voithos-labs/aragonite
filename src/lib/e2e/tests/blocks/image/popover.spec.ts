import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('image properties popover', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('popover appears on selection', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
	});

	test('popover disappears on deselect', async ({ page }) => {
		await editor.loadContent('text\n\n![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		await page.locator('.paragraph-block').first().click();
		await expect(page.locator('.md-image-properties')).not.toBeVisible();
	});

	test('URL edit commits into source on blur', async ({ page }) => {
		// Lead with a non-image paragraph so the click-outside target is genuinely
		// outside the widget — clicking the image's own paragraph would land on
		// the widget itself and (correctly, post-fix) keep the popover open.
		await editor.loadContent('outside paragraph.\n\n![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const urlInput = page.locator('.md-image-properties input').nth(0);
		await urlInput.fill('/test-fixtures/sample.png?v=2');
		await page.locator('.paragraph-block').first().click();
		await editor.bridge.waitForSourceContains('?v=2');
	});

	test('popover commits URL change for image inside a list item', async ({ page }) => {
		await editor.loadContent('outside paragraph.\n\n- ![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const urlInput = page.locator('.md-image-properties input').nth(0);
		await urlInput.fill('/test-fixtures/sample.png?v=nested');
		await page.locator('.paragraph-block').first().click();
		await editor.bridge.waitForSourceContains('?v=nested');
	});

	// Pre-fix the popover was reused across selection changes — local state
	// (`url`, `alt`, plus the closure-captured `initialBytes`) carried image 1's
	// values into image 2's render; clicking outside then committed image 1's
	// fields against the live widgetSelection (image 2) and overwrote image 2's
	// source bytes. Fix: identity-keyed remount + target captured at mount.
	test('popover commit targets the image it opened on, not the live selection', async ({
		page
	}) => {
		await editor.loadContent(
			'![alt1|400](/test-fixtures/sample.png) ![alt2|600](/test-fixtures/sample.png)\n\nbelow.\n'
		);
		await page.waitForFunction(() =>
			Array.from(document.querySelectorAll('[data-image-widget] img')).every(
				(img) => (img as HTMLImageElement).complete
			)
		);
		const widgets = page.locator('[data-image-widget]');
		const w1Box = await widgets.nth(0).boundingBox();
		const w2Box = await widgets.nth(1).boundingBox();
		if (!w1Box || !w2Box) throw new Error('widget boxes missing');
		// Open image 1 popover, edit URL.
		await page.mouse.click(w1Box.x + w1Box.width / 2, w1Box.y + w1Box.height / 2);
		await page.locator('.md-image-properties input').first().fill('/test-fixtures/EDITED.png');
		// Switch to image 2 — old popover unmounts and commits to image 1.
		await page.mouse.click(w2Box.x + w2Box.width / 2, w2Box.y + w2Box.height / 2);
		// Outside click dismisses image 2's popover without changes.
		await page.locator('[contenteditable="true"]').last().click();
		await editor.bridge.waitForSourceContains('EDITED.png');
		const src = await editor.bridge.getSource();
		// Image 1 took the edit; image 2 untouched.
		expect(src).toContain('![alt1|400](/test-fixtures/EDITED.png)');
		expect(src).toContain('![alt2|600](/test-fixtures/sample.png)');
	});

	test('rapid switching between two image popovers without typing leaves both untouched', async ({
		page
	}) => {
		await editor.loadContent(
			'![alt1|400](/test-fixtures/sample.png) ![alt2|600](/test-fixtures/sample.png)\n\nbelow.\n'
		);
		await page.waitForFunction(() =>
			Array.from(document.querySelectorAll('[data-image-widget] img')).every(
				(img) => (img as HTMLImageElement).complete
			)
		);
		const widgets = page.locator('[data-image-widget]');
		const w1Box = await widgets.nth(0).boundingBox();
		const w2Box = await widgets.nth(1).boundingBox();
		if (!w1Box || !w2Box) throw new Error('widget boxes missing');
		const initialSrc = await editor.bridge.getSource();
		for (let i = 0; i < 20; i++) {
			const target = i % 2 === 0 ? w1Box : w2Box;
			await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
		}
		await page.locator('[contenteditable="true"]').last().click();
		expect(await editor.bridge.getSource()).toBe(initialSrc);
	});

	test('no-op blur does not add undo entry', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const undoLengthBefore = await page.evaluate(() => {
			return (window as any).__test?.dumpUndoStack?.()?.length ?? 0;
		});
		await page.locator('.paragraph-block').first().click();
		const undoLengthAfter = await page.evaluate(() => {
			return (window as any).__test?.dumpUndoStack?.()?.length ?? 0;
		});
		expect(undoLengthAfter).toBe(undoLengthBefore);
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

	// Regression: the overlay was previously reparented INTO the widget along
	// with Svelte-generated whitespace text nodes. The widget is `display:
	// block`, so those text nodes created an inline line-box that grew the
	// widget by one line-height when the popover opened — visible as a
	// vertical jump of every block below the image.
	test('opening popover does not shift the widget or the block below it', async ({ page }) => {
		await editor.loadContent('intro\n\n![cat|400x200](/test-fixtures/sample.png)\n\nfollowing.\n');
		const widget = page.locator('[data-image-widget]').first();
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		const widgetTopBefore = (await widget.boundingBox())!.y;
		const widgetHeightBefore = (await widget.boundingBox())!.height;
		const belowYBefore = (await editor.getBlock(2).boundingBox())!.y;

		await widget.click();
		await page.locator('.md-image-properties').waitFor({ state: 'visible' });

		const widgetTopAfter = (await widget.boundingBox())!.y;
		const widgetHeightAfter = (await widget.boundingBox())!.height;
		const belowYAfter = (await editor.getBlock(2).boundingBox())!.y;

		expect(widgetTopAfter).toBe(widgetTopBefore);
		expect(widgetHeightAfter).toBe(widgetHeightBefore);
		expect(belowYAfter).toBe(belowYBefore);
	});

	// Regression: the popover was reparented INTO the widget, so keydown on
	// popover inputs bubbled up through the contenteditable that wraps the
	// widget. The contenteditable's "type while widget selected = replace
	// image" branch fired on every keystroke, deleting the image.
	test('typing into a popover input does not delete the image', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const urlInput = page.locator('.md-image-properties input').nth(0);
		await urlInput.click();
		await page.keyboard.type('?v=2');
		await expect(page.locator('[data-image-widget]')).toBeVisible();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		expect(await urlInput.inputValue()).toContain('?v=2');
	});

	// Regression: clicking from one popover input to another fired the
	// widget's pointerdown listener (because the popover sat inside the widget
	// after reparenting), which re-dispatched `image-widget-select`. The
	// reparent effect then re-ran, transiently detaching the popover from the
	// DOM and triggering a `relatedTarget=null` blur that dismissed it.
	test('clicking between popover input fields keeps the popover open', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.locator('.md-image-properties input').nth(1).click();
		await page.locator('.md-image-properties input').nth(0).click();
		await page.locator('.md-image-properties input').nth(2).click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
	});

	// Regression: the popover was anchored inside the widget DOM, which sits
	// on the first visual line of a list-item paragraph. The list item's
	// trailing inline text wrapped to the line below the image and rendered
	// alongside (or under) the popover — reading as "field labels outside the
	// popover bounds." A position-portal at editor root keeps the popover's
	// own bounds independent of list-item flow.
	test('popover field labels stay inside popover bounds when image is in a list', async ({
		page
	}) => {
		await editor.loadContent(
			'- ![dome|300x200](/test-fixtures/sample.png) trailing text in list item\n- ![sun|300x200](/test-fixtures/sample.png)\n'
		);
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const popover = page.locator('.md-image-properties').first();
		await popover.waitFor({ state: 'visible' });

		const popoverBox = (await popover.boundingBox())!;
		const labelBoxes = await page.locator('.md-image-properties label > span').evaluateAll((els) =>
			els.map((el) => {
				const r = el.getBoundingClientRect();
				return { x: r.x, right: r.x + r.width, y: r.y, bottom: r.y + r.height };
			})
		);
		const popoverRight = popoverBox.x + popoverBox.width;
		const popoverBottom = popoverBox.y + popoverBox.height;
		for (const lb of labelBoxes) {
			expect(lb.x).toBeGreaterThanOrEqual(popoverBox.x - 1);
			expect(lb.right).toBeLessThanOrEqual(popoverRight + 1);
			expect(lb.y).toBeGreaterThanOrEqual(popoverBox.y - 1);
			expect(lb.bottom).toBeLessThanOrEqual(popoverBottom + 1);
		}
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

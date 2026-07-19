import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image popover commit', () => {
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
});

import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image resize', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('pointer drag commits |N to source', async ({ page }) => {
		await editor.loadContent('![cat|400](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const handle = page.locator('.md-resize-handle-right').first();
		const handleBox = await handle.boundingBox();
		if (!handleBox) throw new Error('handle missing');
		await page.mouse.move(handleBox.x + 4, handleBox.y + 4);
		await page.mouse.down();
		await page.mouse.move(handleBox.x + 4 - 100, handleBox.y + 4, { steps: 10 });
		await page.mouse.up();
		await editor.bridge.waitForSourceMatches(/\|\d+\]/);
		const src = await editor.bridge.getSource();
		const match = src.match(/\|(\d+)\]/);
		expect(match).not.toBeNull();
		expect(Number(match![1])).toBeLessThan(400);
	});

	// Pre-fix: each commit rebuilt the inline DOM via `replaceChildren`, but
	// `widgetEl` was passed to the handles as a captured prop value, so after
	// the first drag committed, the handles' `widgetEl` reference pointed at
	// a detached node. The next drag's startWidth measurement returned 0
	// (detached image has no layout), `startWidth < MIN_WIDTH` bailed before
	// pointer capture, and the second drag silently no-op'd.
	test('back-to-back drags both commit (handle resolves widget on demand)', async ({ page }) => {
		await editor.loadContent('![cat|300](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		await page.locator('.md-resize-handle-right').first().waitFor({ state: 'visible' });

		const dragLeft = async (px: number) => {
			const box = await page.locator('.md-resize-handle-right').first().boundingBox();
			if (!box) throw new Error('handle missing');
			await page.mouse.move(box.x + 4, box.y + 4);
			await page.mouse.down();
			await page.mouse.move(box.x + 4 - px, box.y + 4, { steps: 10 });
			await page.mouse.up();
		};

		await dragLeft(50);
		await editor.bridge.waitForSourceContains('|250');
		await dragLeft(50);
		await editor.bridge.waitForSourceContains('|200');
	});

	test('Shift+ArrowRight grows width', async ({ page }) => {
		await editor.loadContent('![cat|400](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.keyboard.press('Shift+ArrowRight');
		await editor.bridge.waitForSourceContains('|420');
	});

	test('Shift+ArrowLeft shrinks width', async ({ page }) => {
		await editor.loadContent('![cat|400](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.keyboard.press('Shift+ArrowLeft');
		await editor.bridge.waitForSourceContains('|380');
	});

	// Parity with the drag path's upper clamp: holding Shift+ArrowRight must not
	// grow the image past the editor content width. A pure-math unit test can't
	// catch a wiring gap between the keyboard and drag entry points.
	test('Shift+ArrowRight caps at editor content width', async ({ page }) => {
		const contentWidth = await editor.editorContainer.evaluate((el) => el.clientWidth);
		const startWidth = contentWidth - 30;
		await editor.loadContent(`![cat|${startWidth}](/test-fixtures/sample.png)\n`);
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		// Each press steps +20px; three presses overshoot the 30px headroom.
		for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
		await editor.bridge.waitForSourceContains(`|${contentWidth}`);
		const src = await editor.bridge.getSource();
		expect(Number(src.match(/\|(\d+)\]/)![1])).toBe(contentWidth);
	});

	test('click-and-release without drag is no-op', async ({ page }) => {
		await editor.loadContent('![cat|400](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const undoBefore = await page.evaluate(
			() => (window as any).__test?.dumpUndoStack?.()?.length ?? 0
		);
		const handle = page.locator('.md-resize-handle-right').first();
		await handle.click();
		const undoAfter = await page.evaluate(
			() => (window as any).__test?.dumpUndoStack?.()?.length ?? 0
		);
		expect(undoAfter).toBe(undoBefore);
	});

	test('broken image shows popover but no resize handles', async ({ page }) => {
		await editor.loadContent('![broken](/test-fixtures/nonexistent.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toHaveClass(/md-image-broken/, { timeout: 5000 });
		await widget.click();
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await expect(page.locator('.md-resize-handle')).toHaveCount(0);
	});

	// Regression: the widget span was previously full-editor-width via
	// `display: block` with no `width: fit-content`, putting the right-edge
	// handle at the editor's right edge instead of the image's.
	test('right handle is positioned at the image edge, not the editor edge', async ({ page }) => {
		await editor.loadContent('![cat|200](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const img = page.locator('[data-image-widget] img').first();
		const handle = page.locator('.md-resize-handle-right').first();
		const imgBox = await img.boundingBox();
		const handleBox = await handle.boundingBox();
		if (!imgBox || !handleBox) throw new Error('img or handle missing');
		// Handle's center should be within 10px of the image's right edge.
		const handleCenterX = handleBox.x + handleBox.width / 2;
		const imageRightX = imgBox.x + imgBox.width;
		expect(Math.abs(handleCenterX - imageRightX)).toBeLessThan(10);
	});
});

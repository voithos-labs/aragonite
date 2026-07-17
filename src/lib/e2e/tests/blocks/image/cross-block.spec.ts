import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image cross-block selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowRight extends selection atomically across widget', async ({ page }) => {
		await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		// The widget carries no textContent, so range.toString() doesn't include
		// the source bytes. Check the structural assertion instead — the widget
		// element falls inside the Range bounds.
		const widgetInRange = await page.evaluate(() => {
			const s = window.getSelection();
			if (!s || s.rangeCount === 0) return false;
			const range = s.getRangeAt(0);
			const widget = document.querySelector('[data-image-widget]');
			return widget ? range.intersectsNode(widget) : false;
		});
		expect(widgetInRange).toBe(true);
	});

	test('cross-block delete removes whole widget', async ({ page }) => {
		await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		// One Shift+ArrowRight atomically jumps across the widget; the widget
		// is a single addressable unit so a second press would extend into 'b'.
		await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('![cat]');
		expect(await editor.bridge.getSource()).toContain('ab\n');
	});

	test('undo restores deleted widget', async ({ page }) => {
		await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceContains('![cat]');
	});

	// A pointer drag that STARTS on the image must reach the block's cross-block
	// machinery. Before the widget stopped propagating its pointerdown, the block
	// never saw the gesture and no drag could originate from an image.
	test('drag starting on an image widget into the next block enters cross-block', async ({
		page
	}) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n\nsecond paragraph\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.waitFor();
		const box = await widget.boundingBox();
		expect(box).not.toBeNull();
		const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
		const end = await editor.pointForOffset([1], 6);

		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		for (let i = 1; i <= 12; i++) {
			const t = i / 12;
			await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
		}
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		await page.mouse.up();
	});
});

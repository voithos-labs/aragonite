import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('per-block error boundary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a throwing block degrades to a fallback; siblings survive; error event fires', async ({
		page
	}) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
		await page.evaluate(() => (window as any).__test.makeBlockThrowOnRender(1));
		await editor.waitForRenderFlush();

		const fallback = page.locator('[data-failed-block]');
		await expect(fallback).toHaveCount(1);
		await expect(fallback).toContainText('beta');

		await expect(editor.getBlock(0)).toContainText('alpha');
		await expect(editor.getBlock(0)).toHaveAttribute('contenteditable', 'true');
		await expect(editor.getBlock(2)).toContainText('gamma');
		await expect(editor.getBlock(2)).toHaveAttribute('contenteditable', 'true');

		const origins = await page.evaluate(() => (window as any).__test.getCapturedErrors());
		expect(origins).toContain('render');

		const src = await page.evaluate(() => (window as any).__test.getSource());
		expect(src).toContain('alpha');
		expect(src).toContain('beta');
		expect(src).toContain('gamma');
	});

	test('undo restoring healthy bytes retries the render on the same instance', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		// An undoable edit to the block we then break, so a single undo restores BOTH
		// the healthy bytes and the pre-break (paragraph) kind to the SAME mounted host
		// — a small doc never windows the block out, so the boundary can't self-heal.
		await editor.clickBlock(1);
		await editor.typeText('X');
		await page.evaluate(() => (window as any).__test.makeBlockThrowOnRender(1));
		await editor.waitForRenderFlush();
		await expect(page.locator('[data-failed-block]')).toHaveCount(1);

		await editor.clickBlock(0);
		await editor.undo();
		await editor.waitForRenderFlush();

		// Reset-on-heal retries the render once the bytes round-trip again, rather than holding
		// the fallback for the life of the instance.
		await expect(page.locator('[data-failed-block]')).toHaveCount(0);
		await expect(editor.getBlock(1)).toContainText('beta');
		await expect(editor.getBlock(1)).toHaveAttribute('contenteditable', 'true');
	});

	test('keyboard traversal skips a failed block in both directions', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await page.evaluate(() => (window as any).__test.makeBlockThrowOnRender(1));
		await editor.waitForRenderFlush();

		// Click (not programmatic focus) so the caret has a measurable rect for
		// the visual-line boundary checks, as a real user's caret would.
		await editor.clickBlock(0);
		await page.keyboard.press('ArrowDown');
		await expect(editor.getBlock(2)).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(editor.getBlock(0)).toBeFocused();
	});
});

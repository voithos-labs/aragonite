import { test, expect } from '@playwright/test';
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
});

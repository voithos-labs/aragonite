import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('cross-block paste over selection — single Ctrl+Z', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('3-block selection replaced by 2-block paste — one undo fully restores', async () => {
		const original = 'Alpha\n\nBeta\n\nGamma\n';
		await editor.loadContent(original);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');

		const pasteMd = 'One\n\nTwo\n';
		await editor.page.evaluate(async (md) => {
			await navigator.clipboard.writeText(md);
		}, pasteMd);

		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForFunction((expected) => {
			return (window as any).__test.getSource().trim() === expected.trim();
		}, pasteMd);

		await editor.undo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected.trim(),
			original
		);
		expect((await editor.getSource()).trim()).toBe(original.trim());
	});

	test('single-paragraph paste over cross-block selection — one undo restores', async () => {
		const original = '# Heading\n\nPara one\n\nPara two\n';
		await editor.loadContent(original);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');

		await editor.page.evaluate(async () => {
			await navigator.clipboard.writeText('replacement');
		});
		await editor.page.keyboard.press('Control+v');

		await editor.page.waitForFunction(
			() => (window as any).__test.getSource().includes('replacement'),
			null
		);

		await editor.undo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected.trim(),
			original
		);
		expect((await editor.getSource()).trim()).toBe(original.trim());
	});
});

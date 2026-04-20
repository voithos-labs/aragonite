import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('cross-block paste — undo / redo round-trip', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste → Ctrl+Z → Ctrl+Y reproduces the post-paste state', async () => {
		const original = 'Alpha\n\nBeta\n\nGamma\n';
		await editor.loadContent(original);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');

		const pasteMd = 'One\n\nTwo\n';
		await editor.page.evaluate(async (md) => {
			await navigator.clipboard.writeText(md);
		}, pasteMd);
		await editor.page.keyboard.press('Control+v');

		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected.trim(),
			pasteMd
		);
		const postPasteSource = (await editor.getSource()).trim();

		await editor.undo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected.trim(),
			original
		);
		expect((await editor.getSource()).trim()).toBe(original.trim());

		await editor.redo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected,
			postPasteSource
		);
		expect((await editor.getSource()).trim()).toBe(postPasteSource);
	});

	test('redo stack clears on forward edit after undo', async () => {
		await editor.loadContent('Alpha\n');
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' forward');
		await editor.page.waitForTimeout(400);

		await editor.undo();
		await editor.typeSlowly('x');
		await editor.page.waitForTimeout(400);

		// Redo should now be a no-op — stack was cleared.
		const before = await editor.getSource();
		await editor.redo();
		expect(await editor.getSource()).toBe(before);
	});
});

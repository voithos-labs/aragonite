import { test, expect } from '../../fixtures';
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
		const postPasteSource = (await editor.bridge.getSource()).trim();

		await editor.undo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected.trim(),
			original
		);
		expect((await editor.bridge.getSource()).trim()).toBe(original.trim());

		await editor.redo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected,
			postPasteSource
		);
		expect((await editor.bridge.getSource()).trim()).toBe(postPasteSource);

		const isCrossBlock = await editor.page.evaluate(
			() => (window as any).__test.isCrossBlockSelection?.() ?? false
		);
		expect(isCrossBlock).toBe(false);
	});

	test('redo stack clears on forward edit after undo', async () => {
		await editor.loadContent('Alpha\n');
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' forward');
		await editor.bridge.waitForSourceContains('Alpha forward');

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('forward');
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('Alphax');

		const before = await editor.bridge.getSource();
		await editor.redo();
		expect(await editor.bridge.getSource()).toBe(before);
	});
});

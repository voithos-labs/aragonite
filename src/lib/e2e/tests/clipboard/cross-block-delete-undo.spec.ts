import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('cross-block delete — Ctrl+Z restores content + selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Delete across 3 blocks → Ctrl+Z restores content and reactivates cross-block selection', async () => {
		const original = 'Alpha\n\nBeta\n\nGamma\n';
		await editor.loadContent(original);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');

		await editor.page.keyboard.press('Delete');
		await editor.page.waitForFunction(() => {
			const src = (window as any).__test.getSource() as string;
			return !src.includes('Alpha') && !src.includes('Gamma');
		});

		await editor.undo();

		// Content restored.
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected.trim(),
			original
		);
		expect((await editor.getSource()).trim()).toBe(original.trim());

		// Cross-block selection state active again.
		const isCrossBlock = await editor.page.evaluate(
			() => (window as any).__test.isCrossBlockSelection?.() ?? false
		);
		expect(isCrossBlock).toBe(true);
	});
});

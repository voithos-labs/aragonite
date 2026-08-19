import { test, expect } from '../../fixtures';
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
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');

		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('Alpha') && !s.includes('Gamma'));

		await editor.undo();
		await editor.bridge.waitForSourceWith((s, e) => s.trim() === e.trim(), original);

		expect(await editor.bridge.isCrossBlockSelection()).toBe(true);
	});
});

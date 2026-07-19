import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list marker — Backspace at raw offset 0', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at raw 0 of first item performs U1 unwrap', async () => {
		await editor.loadContent('- Hello\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Hello' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('Hello\n');
		expect(await editor.bridge.getSource()).toBe('Hello\n');
	});

	test('Backspace at raw 0 of non-first item performs M1 merge', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('- AlphaBeta\n');
		expect(await editor.bridge.getSource()).toBe('- AlphaBeta\n');
	});
});

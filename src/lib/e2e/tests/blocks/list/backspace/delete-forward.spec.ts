import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list Backspace — forward Delete behavior', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// List items are structural peers, not prose continuations.
	test('Delete at end of non-last item is a no-op (list items do not concat via forward delete)', async () => {
		await editor.loadContent('- first\n- middle\n- last\n');
		const middle = editor.page.locator('[contenteditable="true"]', { hasText: 'middle' });
		await middle.click();
		const before = await editor.bridge.getSource();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Delete');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Delete at end of last item merges following paragraph into the last item', async () => {
		await editor.loadContent('- first\n- last item\n\nAfter\n');
		const last = editor.page.locator('[contenteditable="true"]', { hasText: 'last item' });
		await last.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSourceMatches(/^- last itemAfter$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- last itemAfter$/m);
		expect(source).not.toMatch(/^After$/m);
	});
});

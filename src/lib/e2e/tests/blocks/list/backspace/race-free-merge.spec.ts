import { test } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// A character typed straight after Backspace must land at the merge boundary, not on a stale
// block from before the parent merge was written to state.
test.describe('list Backspace: race-free merge then type', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at start of nested-list item then immediate type lands character at merge boundary', async () => {
		await editor.loadContent('- Outer\n  - Inner one\n  - Inner two\n');
		const innerTwo = editor.page.locator('[contenteditable="true"]', { hasText: 'Inner two' });
		await innerTwo.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('Inner oneZInner two');
	});

	test('Backspace at start of non-first item then immediate type lands at merge boundary (no settle wait)', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const beta = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await beta.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('AlphaZBeta');
	});
});

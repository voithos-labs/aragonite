import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// J3 regression: the typed marker raced the merge — landing on a stale block
// before the parent merge published. Backspace + immediate type must land at
// the merge boundary.
test.describe('list Backspace — race-free merge then type', () => {
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
		const source = await editor.bridge.getSource();
		expect(source).toContain('Inner oneZInner two');
	});

	test('Backspace at start of non-first item then immediate type lands at merge boundary (no settle wait)', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const beta = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await beta.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('AlphaZBeta');
		const source = await editor.bridge.getSource();
		expect(source).toContain('AlphaZBeta');
	});
});

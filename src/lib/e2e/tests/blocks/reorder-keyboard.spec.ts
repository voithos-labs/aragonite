import { test } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Reorder resolves the unit from the caret path and moves it among its siblings;
// these cover the three reorderable parents (document, list, blockquote), the
// focus-follow + single-undo guarantees, and that the moved item — not its inner
// paragraph — is what travels. The CST is the source of truth: focus lands at
// offset 0 of the moved block, so a type-after-move check expects the char
// PREFIXED, not appended.
test.describe('keyboard reorder', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Alt+ArrowDown moves a top-level block down, focus follows', async () => {
		await editor.loadContent('A\n\nB\n\nC\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).click();
		await editor.page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/A[\s\S]*C[\s\S]*B/);
		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceMatches(/A[\s\S]*C[\s\S]*XB/);
	});

	test('Alt+ArrowUp moves the THIRD list item up (index >= 2)', async () => {
		await editor.loadContent('- one\n- two\n- three\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'three' }).click();
		await editor.page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceMatches(/- one[\s\S]*- three[\s\S]*- two/);
	});

	test('Alt+ArrowDown moves the FIRST list item down', async () => {
		await editor.loadContent('- one\n- two\n- three\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'one' }).click();
		await editor.page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/- two[\s\S]*- one[\s\S]*- three/);
	});

	test('Alt+ArrowUp moves a blockquote child up; single undo restores', async () => {
		await editor.loadContent('> a\n>\n> b\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'b' }).click();
		await editor.page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceMatches(/> b[\s\S]*> a/);
		await editor.page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceEquals('> a\n>\n> b\n');
	});
});

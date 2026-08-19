import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Reorder resolves the unit from the caret path and moves it among its siblings. Focus lands at
// offset 0 of the moved block, so a type-after-move check expects the character PREFIXED, not
// appended.
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
		await editor.page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals('> a\n>\n> b\n');
	});

	// The reorder unit is any top-level block, not only prose: the atomic leaf kinds resolve the
	// chord through their own runCommand → reorder context wiring, not TextEditableBlock's.
	test('Alt+ArrowDown moves a fenced code block below its sibling; single undo restores', async () => {
		await editor.loadContent('```\ncode\n```\n\ntail\n');
		await editor.getBlock(0).click(); // caret inside the code block
		await editor.page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/tail[\s\S]*```[\s\S]*code[\s\S]*```/);
		await editor.page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals('```\ncode\n```\n\ntail\n');
	});

	test('Alt+ArrowUp moves a thematic break above its sibling', async () => {
		await editor.loadContent('lead\n\n---\n');
		await editor.getBlock(1).click(); // focus the separator (role=separator, tabindex 0)
		await editor.page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceMatches(/---[\s\S]*lead/);
	});

	// A move with no sibling in that direction must change nothing AND push no undo entry, or a
	// boundary press silently consumes a Ctrl+Z; the unit-level clamp test bypasses the
	// keymap-dispatch path.
	test('Alt+Arrow at a boundary is a no-op and creates no undo entry', async () => {
		await editor.loadContent('A\n\nB\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'A' }).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceEquals('XA\n\nB\n');

		await editor.page.keyboard.press('Alt+ArrowUp'); // first block — nothing above
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('XA\n\nB\n');

		await editor.page.keyboard.press('ControlOrMeta+z'); // undoes the typing, not a phantom reorder
		await editor.bridge.waitForSourceEquals('A\n\nB\n');
	});

	test('Alt+ArrowDown on the last block is a no-op', async () => {
		await editor.loadContent('A\n\nB\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).click();
		const before = await editor.bridge.getSource();
		await editor.page.keyboard.press('Alt+ArrowDown');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});
});

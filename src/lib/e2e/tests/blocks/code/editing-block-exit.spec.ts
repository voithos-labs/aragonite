import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('code block editing — edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('exit code block via Enter on empty trailing line', async () => {
		await editor.loadContent('```\nsome code\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('Control+End');
		await editor.page.keyboard.press('Enter');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('after code');
		await editor.bridge.waitForSourceContains('after code');
		const source = await editor.bridge.getSource();
		expect(source).toContain('some code');
		expect(source.indexOf('after code')).toBeGreaterThan(source.lastIndexOf('```'));
	});

	test('ArrowUp in first line exits to previous block', async () => {
		await editor.loadContent('Above paragraph\n\n```\ncode here\n```\n');
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Control+Home');
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.keyboard.press('End');
		await editor.typeText(' appended');
		await editor.bridge.waitForSourceContains('Above paragraph appended');
	});

	// The closer fence is its own visual line, so exiting downward takes two ArrowDowns. One press
	// once looked like an exit only because the typed text landed ON the closer and stopped closing
	// the block.
	test('ArrowDown past the closer line exits to next block', async () => {
		await editor.loadContent('```\ncode here\n```\n\nBelow paragraph\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('Home');
		await editor.typeText('prepended ');
		await editor.bridge.waitForSourceContains('prepended');

		expect(await editor.bridge.getSource()).toBe(
			'```\ncode here\n```\n\nprepended Below paragraph\n'
		);
	});

	test('Backspace at position 0 moves focus without deleting code block', async () => {
		await editor.loadContent('Before\n\n```\ncode\n```\n');
		const countBefore = await editor.bridge.getBlockCount();
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForBlockCount(countBefore);
		// The marker proves focus moved and the fence survived: `getBlockCount()` + a 'code'
		// substring both hold even when the fence merges with the body ('Before```code…'), so only
		// the byte-exact source gates it.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('BeforeX');
		expect(await editor.bridge.getSource()).toBe('BeforeX\n\n```\ncode\n```\n');
	});

	// Home in a fenced block lands the caret just after the opener's `\n`; native Backspace there
	// deletes it, merging the body into the opener. Guard the boundary so the corruption is
	// unreachable.
	test('Backspace immediately after opener fence is a no-op', async () => {
		await editor.loadContent('```\ncode\n```\n');
		// Raw offset 4 — start of the body, just after the opener fence and its newline.
		await editor.focusBlockAtPath([0], 4);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n');
	});

	test('Delete immediately before closer fence is a no-op', async () => {
		await editor.loadContent('```\ncode\n```\n');
		// Raw offset 8 — end of the body, just before the closer fence's leading newline.
		await editor.focusBlockAtPath([0], 8);
		await editor.page.keyboard.press('Delete');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n');
	});

	// Counter-test for the boundary guard: only the two `\n` boundaries are special.
	test('Backspace inside info string trims the info string', async () => {
		await editor.loadContent('```python\ncode\n```\n');
		// offset 9 — just after the 'n' of "python".
		await editor.focusBlockAtPath([0], 9);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('```pytho\n');
		expect(await editor.bridge.getSource()).toBe('```pytho\ncode\n```\n');
	});

	// Sibling not-mergeable kinds share the focus-only Backspace-at-start exit.
	test('Backspace at position 0 of indented code moves focus without deleting', async () => {
		await editor.loadContent('Before\n\n    indented\n');
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('BeforeX');
		expect(await editor.bridge.getSource()).toBe('BeforeX\n\n    indented\n');
	});

	test('Backspace at position 0 of html block moves focus without deleting', async () => {
		await editor.loadContent('Before\n\n<div>html</div>\n');
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('BeforeX');
		expect(await editor.bridge.getSource()).toBe('BeforeX\n\n<div>html</div>\n');
	});
});

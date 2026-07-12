import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Navigation out of a fenced code block: Enter on an empty trailing line,
// vertical arrow exits into adjacent blocks, and the Backspace-at-position-0
// focus-only semantics (no block deletion).

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

	test('ArrowDown in last line exits to next block', async () => {
		await editor.loadContent('```\ncode here\n```\n\nBelow paragraph\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('prepended ');
		await editor.bridge.waitForSourceContains('prepended');
	});

	test('Backspace at position 0 moves focus without deleting code block', async () => {
		await editor.loadContent('Before\n\n```\ncode\n```\n');
		const countBefore = await editor.bridge.getBlockCount();
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForBlockCount(countBefore);
		// Type a marker — it must land at the end of "Before", proving (a) focus
		// moved to the previous paragraph and (b) the code block's raw is intact.
		// `getBlockCount()` + substring 'code' both hold even when the fence
		// merges with the body (e.g. 'Before```code...'), so this assertion gates
		// the structural-corruption regression directly.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('BeforeX');
		expect(await editor.bridge.getSource()).toBe('BeforeX\n\n```\ncode\n```\n');
	});

	// The fence-boundary corruption surfaced through "Home then Backspace".
	// Home in a fenced block goes to the start of the current visual line, so
	// from the body the caret lands just after the opener's `\n`. Native
	// Backspace at that position deletes the `\n`, merging the body into the
	// opener (e.g. ` ```\ncode ` → ` ```code `). Guard the boundary directly so
	// the corruption is structurally impossible.
	test('Backspace immediately after opener fence is a no-op', async () => {
		await editor.loadContent('```\ncode\n```\n');
		// Position the caret at raw offset 4 — start of body's first column,
		// i.e. just after the opener fence + its trailing newline.
		await editor.focusBlockAtPath([0], 4);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n');
	});

	test('Delete immediately before closer fence is a no-op', async () => {
		await editor.loadContent('```\ncode\n```\n');
		// Position caret at raw offset 8 — end of body's last column,
		// i.e. just before the closer fence's leading newline.
		await editor.focusBlockAtPath([0], 8);
		await editor.page.keyboard.press('Delete');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n');
	});

	// Counter-test for the boundary guard: only the two `\n` boundaries are
	// special. Backspace inside the info string must still edit the info string.
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

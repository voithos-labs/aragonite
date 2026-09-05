import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// Traversal after a structural edit rebuilt the quote — the stale-`innerBlockRefs` class. Every
// fixture's empty middle is built by a real Enter, not loaded: the regression these guard is the
// split's own re-render, which a loaded document never runs.
const QUOTE = '> 1\n>\n> 2\n';

test.describe('blockquote navigation — after a structural edit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(QUOTE);
		await editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ }).click();
	});

	test('Enter at end of inner paragraph, then ArrowDown from empty paragraph reaches next paragraph', async () => {
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(4);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Z2$/m);
	});

	test('Enter at end of inner paragraph, then ArrowUp from empty paragraph reaches previous paragraph', async () => {
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(4);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Z1$/m);
	});

	test('Delete empty middle paragraph, then ArrowDown crosses the gap', async () => {
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(4);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForBlockHostCount(3);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		// Either order: the click can leave the caret on either side of "2". `[2Z]+` alone would
		// also match the untouched "> 2", so an ArrowDown that never crossed the gap would pass.
		await editor.bridge.waitForSourceMatches(/^> (?:2Z|Z2)$/m);
	});

	test('After U2 unwrap: ArrowDown from lifted block enters the shrunk blockquote', async () => {
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => !/^> 1$/m.test(s));
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Z2$/m);
	});

	test('sequence of unrelated edits does not break final navigation', async () => {
		await editor.page.keyboard.press('End');
		await editor.typeText(' extra');
		await editor.bridge.waitForSourceContains(' extra');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(4);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Z2$/m);
		expect(await editor.bridge.getSource()).toContain(' extra');
	});
});

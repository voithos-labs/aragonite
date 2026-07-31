import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('selection — keyboard: edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowDown at last block stays inactive', async () => {
		await editor.loadContent('only block\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(false);
	});

	test('Shift+ArrowUp at first block stays inactive', async () => {
		await editor.loadContent('only block\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(false);
	});

	test('Ctrl+A counter resets on non-Ctrl+A keystroke', async () => {
		await editor.loadContent('one\n\ntwo\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(false);
	});

	test('Shift+ArrowDown from paragraph into blockquote activates cross-block', async () => {
		await editor.loadContent('above\n\n> inside quote\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path[0]).toBe(1);
	});

	test('empty document: double Ctrl+A then typed char replaces the empty block without crashing', async () => {
		// Asserted through a TYPED character, not through `getSource()` being unchanged: Ctrl+A
		// mutates nothing, so that would pass trivially. A regression in the double-press
		// escalation or the type-replace path crashes, adds blocks, or loses the char.
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);

		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+a');

		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		expect(await editor.getDomBlockCount()).toBe(1);
		// The typed char must land in the surviving block. Exact line-ending
		// shape is browser-controlled and not the regression we're guarding.
		expect(await editor.bridge.getSource()).toContain('X');
	});

	test('thematic break between endpoints gets overlay, no crash', async () => {
		await editor.loadContent('above\n\n---\n\nbelow\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.getBlockCount()).toBe(3);
	});
});

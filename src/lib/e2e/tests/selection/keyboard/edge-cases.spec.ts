import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('selection: keyboard: edge cases', () => {
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

	// The table sibling of the case above. Asserted through the state, never through
	// `[data-cross-block]`: that attribute is what a stale pair hides the caret with, so waiting
	// on it reads a selection nothing paints as no selection at all.
	test('Shift+ArrowDown out of a last-block table leaves the cell editable', async () => {
		await editor.loadContent('intro\n\n| aa | bb |\n| -- | -- |\n| cc | wxyz |\n');
		await editor.page.locator('.table-cell').last().click();
		await editor.page.keyboard.press('End');
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForRenderFlush();
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);

		// One character, not the whole cell: a stored pair would route this press into the
		// rectangular delete, which clears every covered cell at once and paints nothing.
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('| cc | wxy |');
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
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('ControlOrMeta+a');
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
		// Asserted through a typed character, not through `getSource()` being unchanged: Ctrl+A
		// changes nothing, so that would pass trivially. A break in the double-press escalation
		// or in type-replace crashes, adds blocks, or loses the character.
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);

		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.page.keyboard.press('ControlOrMeta+a');

		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		expect(await editor.getDomBlockCount()).toBe(1);
		// The typed character must land in the surviving block. The exact line ending is up
		// to the browser and is not what this guards.
		expect(await editor.bridge.getSource()).toContain('X');
	});

	test('thematic break between endpoints gets overlay, no crash', async () => {
		await editor.loadContent('above\n\n---\n\nbelow\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.getBlockCount()).toBe(3);
	});
});

import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable, capturedErrors } from './helpers';

/**
 * The `[^label]` reference as a first-class inline widget: a superscript showing the footnote
 * number, which swaps to its raw source for editing. The test that matters is renumbering as you
 * type: an earlier reference typed into another block shifts a widget's number although its own
 * block is never edited and its source, the key it is stored under, never changes, which a number
 * captured at mount could not do. Seed `footnotes-ref`: block 1 holds `[^a]` and `[^b]`, then the
 * two definitions.
 */

const refsInBlock = (editor: PluginsPage, block: number) =>
	editor.page.locator(`[data-block-path='[${block}]'] .footnote-ref`);

test.describe('plugin inline footnote references', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('footnotes-ref');
	});

	test('renders each reference as a superscript numbered by first-reference order', async () => {
		const refs = refsInBlock(editor, 1);
		await expect(refs).toHaveCount(2);
		await expect(refs.nth(0)).toHaveText('1');
		await expect(refs.nth(1)).toHaveText('2');
		// The literal bytes stay in the source: the widget hides them but keeps them.
		expect(await editor.bridge.getSource()).toContain('Body has [^a] and [^b] here.');
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('renumbers a later widget live when an earlier reference is added elsewhere', async ({
		page
	}) => {
		await expect(refsInBlock(editor, 1).nth(0)).toHaveText('1');

		// Type an earlier reference into block 0. Block 1 is never touched, and each block-1
		// widget's source (`[^a]`, `[^b]`) is unchanged, so the same widget instances are kept
		// and only the derived number can move them.
		await editor.focusBlockStart(0);
		await editor.typeText('[^z] ');
		await editor.bridge.waitForSourceContains('[^z] Intro');

		// block 0's new reference is first; block 1's shift down by one.
		await expect(refsInBlock(editor, 0)).toHaveText('1');
		await expect(refsInBlock(editor, 1).nth(0)).toHaveText('2');
		await expect(refsInBlock(editor, 1).nth(1)).toHaveText('3');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a reference typed live renders once its closing bracket lands', async ({ page }) => {
		// Append into block 1, after the two seeded references, so the new one is last
		// in document order (number 3).
		await editor.focusBlockEnd(1);
		await editor.typeText(' see [^c');
		await editor.waitForRenderFlush();
		// Unterminated: still literal text, only the two seeded widgets so far.
		await expect(refsInBlock(editor, 1)).toHaveCount(2);

		await editor.typeText(']');
		await editor.bridge.waitForSourceContains('[^c]');
		await expect(refsInBlock(editor, 1)).toHaveCount(3);
		await expect(refsInBlock(editor, 1).nth(2)).toHaveText('3');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('caret entry reveals the raw source without touching the CST', async ({ page }) => {
		// "Body has " is 9 characters: 9 steps reach the widget's leading edge, the 10th enters.
		await editor.focusBlockStart(1);
		for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');

		// The 'a' widget is gone and its raw `[^a]` is editable text.
		await expect(refsInBlock(editor, 1)).toHaveCount(1);
		expect(await editor.getBlockText(1)).toContain('[^a]');
		// Showing the source only changes the view: the source itself is unchanged.
		expect(await editor.bridge.getSource()).toContain('Body has [^a] and [^b] here.');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('editing a revealed label re-renders the widget and lands one undo entry', async ({
		page
	}) => {
		await editor.focusBlockStart(1);
		for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await expect(refsInBlock(editor, 1)).toHaveCount(1);

		// The caret sits at the shown source's leading edge: step past `[^a`, append to the label,
		// then step the caret out of the source to commit.
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('x');
		await page.keyboard.press('End');

		await editor.bridge.waitForSourceContains('[^ax]');
		expect(await editor.bridge.getSource()).toContain('Body has [^ax] and [^b] here.');
		await expect(refsInBlock(editor, 1)).toHaveCount(2);
		expect(await roundTripStable(page)).toBe(true);

		// One undo restores the seed bytes: showing, editing and committing is one entry.
		await editor.waitForUndoBatchFlush();
		await editor.undo();
		await editor.bridge.waitForSourceContains('Body has [^a] and [^b] here.');
		expect(await editor.bridge.getSource()).toContain('Body has [^a] and [^b] here.');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a destructive key adjacent to a folded reference reveals it, not deletes it whole', async ({
		page
	}) => {
		// Caret immediately before the rendered `[^a]` widget, at the end of "Body has ".
		await editor.focusBlockAtPath([1], 9);
		await page.keyboard.press('Delete');
		await editor.waitForRenderFlush();

		// This widget swaps to its editable source instead of being deleted, so the four `[^a]`
		// bytes are intact and only the 'a' widget is gone. An atomic widget would have deleted
		// all four bytes with this one keypress.
		expect(await editor.bridge.getSource()).toContain('Body has [^a] and [^b] here.');
		await expect(refsInBlock(editor, 1)).toHaveCount(1);

		// The shown source edits one byte per keypress: deleting the opening `[` and committing
		// turns the reference into literal text.
		await page.keyboard.press('Delete');
		await page.keyboard.press('End');
		await editor.bridge.waitForSourceContains('Body has ^a] and [^b] here.');
		// The reference is gone from the body; the `[^a]:` definition marker keeps its own bytes,
		// so the assertion is limited to the body line.
		expect(await editor.bridge.getSource()).not.toContain('Body has [^a]');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable, capturedErrors } from './helpers';

/**
 * The `[^label]` reference as a first-class inline widget: a superscript rendering
 * the derived footnote number, revealed to its raw source for editing. The load-
 * bearing pin is the LIVE renumber — an earlier reference typed into another block
 * shifts a widget's number though its own block is never edited and its source
 * (the pool key) never changes. That reactive read is exactly what a mount-time
 * snapshot could not deliver, so it can only be proven through the real render path.
 *
 * Seed `footnotes-ref`: block 0 "Intro line here.", block 1 "Body has [^a] and
 * [^b] here." (two references), then the two definitions.
 */

const refsInBlock = (editor: PluginsPage, block: number) =>
	editor.page.locator(`[data-block-path='[${block}]'] .footnote-ref`);

test.describe('plugin inline footnote references', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('footnotes-ref');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('renders each reference as a superscript numbered by first-reference order', async () => {
		const refs = refsInBlock(editor, 1);
		await expect(refs).toHaveCount(2);
		await expect(refs.nth(0)).toHaveText('1');
		await expect(refs.nth(1)).toHaveText('2');
		// The literal bytes stay in the source — the widget hides but preserves them.
		expect(await editor.bridge.getSource()).toContain('Body has [^a] and [^b] here.');
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('renumbers a later widget live when an earlier reference is added elsewhere', async ({
		page
	}) => {
		await expect(refsInBlock(editor, 1).nth(0)).toHaveText('1');

		// Type an EARLIER reference into block 0. Block 1 is never touched, and each
		// block-1 widget's source (`[^a]`, `[^b]`) is unchanged, so the pool keeps the
		// same instances — only the reactive number derivation can move them.
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
		// "Body has " is 9 chars; 9 steps reach the widget's leading edge, the 10th enters.
		await editor.focusBlockStart(1);
		for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');

		// The 'a' widget is gone (revealed); its raw `[^a]` is now editable text.
		await expect(refsInBlock(editor, 1)).toHaveCount(1);
		expect(await editor.getBlockText(1)).toContain('[^a]');
		// Reveal is a view toggle — the source is unchanged.
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

		// Caret sits at the revealed source's leading edge; step past `[^a` and append
		// to the label, then commit with Enter.
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('x');
		await page.keyboard.press('Enter');

		await editor.bridge.waitForSourceContains('[^ax]');
		expect(await editor.bridge.getSource()).toContain('Body has [^ax] and [^b] here.');
		await expect(refsInBlock(editor, 1)).toHaveCount(2);
		expect(await roundTripStable(page)).toBe(true);

		// One undo restores the seed bytes — the reveal→edit→commit cycle is one entry.
		await editor.waitForUndoBatchFlush();
		await editor.undo();
		await editor.bridge.waitForSourceContains('Body has [^a] and [^b] here.');
		expect(await editor.bridge.getSource()).toContain('Body has [^a] and [^b] here.');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a destructive key adjacent to a folded reference reveals it, not deletes it whole', async ({
		page
	}) => {
		// Caret immediately before the folded `[^a]` widget (end of the "Body has " run).
		await editor.focusBlockAtPath([1], 9);
		await page.keyboard.press('Delete');
		await editor.waitForRenderFlush();

		// The reveal policy folds the widget out to editable source — a view toggle, so
		// the four `[^a]` bytes are intact and only the 'a' widget is gone (revealed to
		// text). An atomic policy would have deleted all four bytes in this one press.
		expect(await editor.bridge.getSource()).toContain('Body has [^a] and [^b] here.');
		await expect(refsInBlock(editor, 1)).toHaveCount(1);

		// The revealed source edits one byte per press: deleting the opening `[` and
		// committing degrades the reference to literal text.
		await page.keyboard.press('Delete');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('Body has ^a] and [^b] here.');
		// The reference is gone from the body (the `[^a]:` definition marker keeps its
		// own bytes, so scope the negative to the body line).
		expect(await editor.bridge.getSource()).not.toContain('Body has [^a]');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

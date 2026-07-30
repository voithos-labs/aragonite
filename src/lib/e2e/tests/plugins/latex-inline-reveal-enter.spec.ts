import { test, expect } from '../../fixtures';
import { capturedErrors } from './helpers';
import { MathRevealPage } from './latex-reveal-helpers';

/**
 * Enter's block meaning inside a revealed inline source. The reveal used to claim
 * the key as a commit gesture, which cost the user the press twice over: at a
 * source edge it moved the caret past the widget instead of splitting, and on a
 * source already broken into plain text it did nothing visible, so the split needed
 * a second press. Enter now commits the edit AND splits, through the fold seam
 * (`latex-inline-reveal-commands.spec.ts`); Escape stays the reveal's only key.
 *
 * Each case asserts the split structurally (block count + bytes) and the caret by
 * typing, because `getSource()` is correct wherever focus landed.
 */

test.describe('Enter splits a block whose inline source is revealed', () => {
	let editor: MathRevealPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathRevealPage(page);
		await editor.gotoPlugins('math');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('at the revealed leading edge it splits and keeps the caret before the math', async ({
		page
	}) => {
		await editor.loadContent('$x^2$ tail\n');
		await editor.revealFromLeadingEdge(0);

		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getSource()).toBe('\n$x^2$ tail\n');

		// The reported symptom was the caret landing PAST the widget instead.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z$x^2$ tail');
		expect(await editor.bridge.getSource()).not.toContain('$x^2$Z');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('it splits on the FIRST press after the revealed source is broken', async ({ page }) => {
		await editor.loadContent('$x^2$\n');
		await editor.revealFromTrailingEdge(0);
		// Eat the closing delimiter: the bytes are plain text now, not a construct.
		await editor.backspaceRevealed(0, ['$x^2']);

		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getSource()).toBe('$x^2\n\n\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('mid-source it commits the ephemeral edit as it splits', async ({ page }) => {
		await editor.loadContent('$x^2$ tail\n');
		await editor.revealFromLeadingEdge(0, 3);
		await page.keyboard.type('q');
		await expect(editor.getBlock(0)).toHaveText('$x^q2$ tail');

		// The split lands where the caret is, and the ephemeral edit reaches the CST
		// rather than being discarded by the structural op. Two blank-line-separated
		// paragraphs is the editor's ordinary mid-paragraph split shape (a plain
		// `abcdef` split at 3 serializes the same way), not a reveal artifact.
		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getSource()).toBe('$x^q\n\n2$ tail\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

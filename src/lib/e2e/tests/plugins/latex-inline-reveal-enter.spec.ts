import { test, expect } from '../../fixtures';
import { capturedErrors } from './helpers';
import { MathRevealPage } from './latex-reveal-helpers';

/**
 * What Enter means inside an open inline source: it commits the edit and splits the block, through
 * the same commit-first path as `latex-inline-reveal-commands.spec.ts`, and Escape stays the only
 * key the open source keeps. Each case asserts the split by block count and bytes, and the caret
 * by typing.
 */

test.describe('Enter splits a block whose inline source is revealed', () => {
	let editor: MathRevealPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathRevealPage(page);
		await editor.gotoPlugins('math');
	});

	test('at the revealed leading edge it splits and keeps the caret before the math', async ({
		page
	}) => {
		await editor.loadContent('$x^2$ tail\n');
		await editor.revealFromLeadingEdge(0);

		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getSource()).toBe('\n$x^2$ tail\n');

		// The reported symptom was the caret landing past the widget instead.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z$x^2$ tail');
		expect(await editor.bridge.getSource()).not.toContain('$x^2$Z');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('it splits on the first press after the revealed source is broken', async ({ page }) => {
		await editor.loadContent('$x^2$\n');
		await editor.revealFromTrailingEdge(0);
		// Delete the closing delimiter: the bytes are plain text now, not a construct.
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

		// The split lands where the caret is, and the uncommitted edit reaches the CST rather than
		// being dropped by the structural edit. Two paragraphs separated by a blank line is the
		// editor's ordinary mid-paragraph split, not something this path invents.
		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getSource()).toBe('$x^q\n\n2$ tail\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

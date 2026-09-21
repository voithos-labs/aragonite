import type { Locator } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';
import { MathRevealPage } from './latex-reveal-helpers';

/**
 * Commit first: a block command fired while an inline source is open must run against the
 * committed bytes. An open source holds the block's live bytes in DOM the CST has never seen, so
 * every command, all of which read `node.raw`, would otherwise splice the bytes from before it
 * opened. Every case that asserts a command has a sibling proving the keys that are not commands
 * did not change. Enter's own rule is in `latex-inline-reveal-enter.spec.ts`. The two cases at the
 * bottom use other kinds, which is the point: the rule is the editor's, not latex's.
 */

test.describe('block commands against a revealed inline source', () => {
	let editor: MathRevealPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathRevealPage(page);
		await editor.gotoPlugins('math');
	});

	test('backspace-merging an emptied reveal does not resurrect the deleted math', async ({
		page
	}) => {
		await editor.loadContent('above\n\n$x^2$\n');
		await editor.revealFromTrailingEdge(1);

		// Delete the whole open source one byte at a time. None of this reaches the CST, so
		// `getSource()` still reads the bytes from before it opened.
		await editor.backspaceRevealed(1, ['$x^2', '$x^', '$x', '$', '']);
		expect(await editor.bridge.getSource()).toBe('above\n\n$x^2$\n');

		// The caret now sits at offset 0 of an empty block, so this Backspace merges blocks, and
		// it must merge the empty block rather than the stale `$x^2$` bytes.
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForBlockCount(1);
		expect(await editor.bridge.getSource()).toBe('above\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('backspace-merging an edited-but-valid reveal merges the edited bytes', async ({ page }) => {
		await editor.loadContent('above\n\n$x^2$\n');
		await editor.revealFromTrailingEdge(1);

		// Step inside and type: the source still parses as math, so nothing about the construct
		// is broken and only the CST is behind. This is the case that rules out "commit when the
		// edit breaks the construct" as the rule.
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('q');
		await expect(editor.getBlock(1)).toHaveText('$x^2q$');
		expect(await editor.bridge.getSource()).toBe('above\n\n$x^2$\n');

		// Home lands at raw 0, the source's leading edge, still inside the open source, so nothing
		// closes. Backspace there merges against bytes the CST does not have.
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForBlockCount(1);
		expect(await editor.bridge.getSource()).toBe('above$x^2q$\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Backspace mid-source still edits the revealed source natively', async () => {
		await editor.loadContent('above\n\n$x^2$\n');
		await editor.revealFromTrailingEdge(1);

		// At any offset but zero the merge command declines, so the key stays a plain source edit
		// and the open source must not close underneath it.
		await editor.backspaceRevealed(1, ['$x^2', '$x^']);
		await expect(editor.mathWidget).toHaveCount(0);
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getSource()).toBe('above\n\n$x^2$\n');
	});

	test('ArrowRight leaves a block whose edited reveal sits at its end', async ({ page }) => {
		await editor.loadContent('$x^2$\n\nbelow\n');
		await editor.revealFromTrailingEdge(0);
		// Delete the closing `$`: the live bytes are now shorter than node.raw, so any edge check
		// measured against the stale raw reads the caret as mid-block, a trap where the caret can
		// never leave rightward and the source never closes.
		await editor.backspaceRevealed(0, ['$x^2']);

		await page.keyboard.press('ArrowRight');
		await editor.bridge.waitForSourceContains('$x^2\n');

		// Focus is in the block below, asserted by typing rather than by the source.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Zbelow');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Mod+B over a selection touching a revealed source toggles the committed bytes', async ({
		page
	}) => {
		await editor.loadContent('$x^2$ tail\n');
		await editor.revealFromLeadingEdge(0, 3);
		await page.keyboard.type('q');
		await expect(editor.getBlock(0)).toHaveText('$x^q2$ tail');

		// A selection inside the open source does not count as leaving it, so it is still open
		// when the chord fires. This is also where the caret write on commit could collapse the
		// range out from under the toggle.
		await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('ControlOrMeta+b');

		await editor.bridge.waitForSourceContains('**');
		expect(await editor.bridge.getSource()).toBe('$x**^q**2$ tail\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Mod+1 over a revealed block cycles the heading on the committed bytes', async ({
		page
	}) => {
		await editor.loadContent('$x^2$ tail\n');
		await editor.revealFromLeadingEdge(0, 3);
		await page.keyboard.type('q');

		// The commands that always apply must see the edit too: a heading prefix written onto
		// node.raw would drop the `q` the CST has not been told about.
		await page.keyboard.press('ControlOrMeta+1');
		await editor.bridge.waitForSourceContains('# ');
		expect(await editor.bridge.getSource()).toBe('# $x^q2$ tail\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Escape still cancels the reveal and discards the ephemeral edit', async ({ page }) => {
		await editor.loadContent('above\n\n$x^2$\n');
		await editor.revealFromTrailingEdge(1);
		await editor.backspaceRevealed(1, ['$x^2', '$x^']);

		await page.keyboard.press('Escape');
		await expect(editor.mathWidget).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe('above\n\n$x^2$\n');
	});
});

// The commit happens in the block's command dispatch, which cannot know which widget kind opened.
// These two cases prove it: the other two kinds declaring `revealSource: true`, footnote
// references and inline directive text, take the same merge with no code of their own.
test.describe('the fold seam is core, not latex-local', () => {
	/** Open the widget that is block 1's whole content by Backspacing at its trailing edge, delete
	 *  its bytes one keypress at a time, then merge into block 0. */
	async function emptyThenMerge(
		editor: PluginsPage,
		widget: Locator,
		texts: string[]
	): Promise<void> {
		const { keyboard } = editor.page;
		await editor.focusBlockEnd(1);
		await keyboard.press('Backspace');
		await expect(widget).toHaveCount(0);
		for (const expected of texts) {
			await keyboard.press('Backspace');
			await expect(editor.getBlock(1)).toHaveText(expected);
		}
		await keyboard.press('Backspace');
	}

	test('backspace-merging an emptied footnote-reference reveal does not resurrect it', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('footnotes-ref');
		await editor.loadContent('above\n\n[^a]\n\n[^a]: note\n');
		const ref = page.locator('.footnote-ref');
		await expect(ref).toHaveCount(1);

		await emptyThenMerge(editor, ref, ['[^a', '[^', '[', '']);
		await editor.bridge.waitForBlockCount(2);
		// The emptied block takes its own blank line with it, the ordinary result of merging an
		// emptied middle block, which happens with no widget in the document at all. What this
		// pins is that `[^a]` is gone from the merged bytes rather than brought back.
		const merged = await editor.bridge.getSource();
		expect(merged).toBe('above\n\n[^a]: note\n');
		expect(await capturedErrors(page)).toEqual([]);

		// A leftover blank line would reload as a block the live tree does not have.
		await editor.loadContent(merged);
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});

	test('backspace-merging an emptied directive-text reveal does not resurrect it', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await editor.loadContent('above\n\n:abbr[HTML]\n');
		const widget = page.locator('.directive-text-widget');
		await expect(widget).toHaveCount(1);

		// `:abbr[HTML]` is eleven bytes. The widget renders its source verbatim either way, so
		// what shows whether it is open is the widget count, not the text.
		await emptyThenMerge(editor, widget, [
			':abbr[HTML',
			':abbr[HTM',
			':abbr[HT',
			':abbr[H',
			':abbr[',
			':abbr',
			':abb',
			':ab',
			':a',
			':',
			''
		]);
		await editor.bridge.waitForBlockCount(1);
		expect(await editor.bridge.getSource()).toBe('above\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

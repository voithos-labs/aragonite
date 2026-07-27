import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * Block commands fired while an inline source reveal is open. The reveal holds the
 * block's live bytes in ephemeral DOM the CST has never seen, so a command that
 * reads `node.raw` — merge, split — is reading the pre-reveal source. This suite
 * pins the fold seam that closes that gap, plus Enter's block meaning surviving it.
 *
 * The reveal's own editing (a Backspace mid-source) must stay native, so each case
 * that asserts a command also has a sibling proving the non-command press did not
 * change. The footnote case proves the seam is core, not latex-local.
 */

class RevealCommandsPage extends PluginsPage {
	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}

	/** Open the trailing-edge reveal on the math in `block`: place the caret past
	 *  the widget, then one Backspace, which reveals without touching a byte. */
	async revealFromTrailingEdge(block: number): Promise<void> {
		await this.focusBlockEnd(block);
		await this.page.keyboard.press('Backspace');
		await expect(this.mathWidget).toHaveCount(0);
	}

	/** Backspace `count` times, settling on the revealed source's visible text after
	 *  each press. The CST is frozen while revealed, so the DOM is the only oracle. */
	async backspaceRevealed(block: number, texts: string[]): Promise<void> {
		for (const expected of texts) {
			await this.page.keyboard.press('Backspace');
			await expect(this.getBlock(block)).toHaveText(expected);
		}
	}
}

test.describe('block commands against a revealed inline source', () => {
	let editor: RevealCommandsPage;

	test.beforeEach(async ({ page }) => {
		editor = new RevealCommandsPage(page);
		await editor.gotoPlugins('math');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('backspace-merging an emptied reveal does not resurrect the deleted math', async ({
		page
	}) => {
		await editor.loadContent('above\n\n$x^2$\n');
		await editor.revealFromTrailingEdge(1);

		// Eat the whole revealed source one byte at a time. None of this reaches the
		// CST — `getSource()` still reads the pre-reveal bytes throughout.
		await editor.backspaceRevealed(1, ['$x^2', '$x^', '$x', '$', '']);
		expect(await editor.bridge.getSource()).toBe('above\n\n$x^2$\n');

		// The caret now sits at offset 0 of an empty block: this Backspace is a block
		// merge, and it must merge the EMPTY block, not the stale `$x^2$` bytes.
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForBlockCount(1);
		expect(await editor.bridge.getSource()).toBe('above\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('backspace-merging an edited-but-valid reveal merges the edited bytes', async ({ page }) => {
		await editor.loadContent('above\n\n$x^2$\n');
		await editor.revealFromTrailingEdge(1);

		// Step inside and type — the source still parses as math, so nothing about the
		// construct is broken; only the CST is behind.
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('q');
		await expect(editor.getBlock(1)).toHaveText('$x^2q$');
		expect(await editor.bridge.getSource()).toBe('above\n\n$x^2$\n');

		// Home lands at raw 0 — the source's leading edge, still inside the reveal, so
		// no escape fold. Backspace there is a merge against bytes the CST lacks.
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForBlockCount(1);
		expect(await editor.bridge.getSource()).toBe('above$x^2q$\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Backspace mid-source still edits the revealed source natively', async () => {
		await editor.loadContent('above\n\n$x^2$\n');
		await editor.revealFromTrailingEdge(1);

		// A non-zero caret offset declines the merge command, so the press stays a
		// plain source edit — the reveal must not fold underneath it.
		await editor.backspaceRevealed(1, ['$x^2', '$x^']);
		await expect(editor.mathWidget).toHaveCount(0);
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getSource()).toBe('above\n\n$x^2$\n');
	});

	test('Enter at the revealed leading edge splits the block and keeps the caret before it', async ({
		page
	}) => {
		await editor.loadContent('$x^2$ tail\n');
		// ArrowRight from offset 0 enters the widget's leading edge, revealing there.
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		await expect(editor.mathWidget).toHaveCount(0);

		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getSource()).toBe('\n$x^2$ tail\n');

		// Assert the caret by typing: it must land BEFORE the math, not past it.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z$x^2$ tail');
		expect(await editor.bridge.getSource()).not.toContain('$x^2$Z');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Enter splits on the FIRST press after the revealed source is broken', async ({ page }) => {
		await editor.loadContent('$x^2$\n');
		await editor.revealFromTrailingEdge(0);
		// Eat the closing delimiter: the bytes are plain text now, not a construct.
		await editor.backspaceRevealed(0, ['$x^2']);

		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getSource()).toBe('$x^2\n\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Enter mid-source commits the edit as it splits', async ({ page }) => {
		await editor.loadContent('$x^2$ tail\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		await expect(editor.mathWidget).toHaveCount(0);
		// Walk to `$x^|2$` and type inside the formula.
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('q');
		await expect(editor.getBlock(0)).toHaveText('$x^q2$ tail');

		// The split lands where the caret is, and the ephemeral edit reaches the CST
		// rather than being discarded by the structural op. Two paragraphs with a
		// single separating newline is the editor's ordinary mid-paragraph split shape
		// (a plain `abcdef` split at 3 serializes the same way), not a reveal artifact.
		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getSource()).toBe('$x^q\n2$ tail\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('ArrowRight leaves a block whose edited reveal sits at its end', async ({ page }) => {
		await editor.loadContent('$x^2$\n\nbelow\n');
		await editor.revealFromTrailingEdge(0);
		// Eat the closing `$`: the live bytes are now SHORTER than node.raw, so every
		// boundary test measured against the stale raw reads the caret as mid-block and
		// the caret can never leave rightward — a trap, and the reveal never folds.
		await editor.backspaceRevealed(0, ['$x^2']);

		await page.keyboard.press('ArrowRight');
		await editor.bridge.waitForSourceContains('$x^2\n');

		// Focus is in the block below, asserted by typing rather than by the source.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Zbelow');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a caret snapped past a trailing math widget paints exactly one caret', async ({ page }) => {
		await editor.loadContent('$x^2$\n');
		const box = await editor.mathWidget.boundingBox();
		if (!box) throw new Error('math widget has no bounding box');

		// Click to the right of the widget with no trailing text to anchor in: the
		// caret lands at an element-level offset, where the editor paints a synthetic
		// caret because Chromium's own is unreliable there. When Chromium DOES paint,
		// the user sees two — so the native one is suppressed for as long as the
		// synthetic is up.
		await page.mouse.click(box.x + box.width + 25, box.y + box.height / 2);
		await expect(page.locator('[data-inline-widget].md-snap-after')).toHaveCount(1);
		const caretColor = await page.evaluate(
			() => getComputedStyle(document.querySelector('.text-editable-block')!).caretColor
		);
		expect(caretColor).toBe('rgba(0, 0, 0, 0)');
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

test.describe('the fold seam is core, not latex-local', () => {
	let editor: RevealCommandsPage;

	test.beforeEach(async ({ page }) => {
		editor = new RevealCommandsPage(page);
		await editor.gotoPlugins('footnotes-ref');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('backspace-merging an emptied footnote-reference reveal does not resurrect it', async ({
		page
	}) => {
		// A second `revealSource: true` kind, driven through the same seam.
		await editor.loadContent('above\n\n[^a]\n\n[^a]: note\n');
		const ref = page.locator('.footnote-ref');
		await expect(ref).toHaveCount(1);

		await editor.focusBlockEnd(1);
		await page.keyboard.press('Backspace');
		await expect(ref).toHaveCount(0);

		// `[^a]` is four bytes; eat them all, then merge.
		for (const expected of ['[^a', '[^', '[', '']) {
			await page.keyboard.press('Backspace');
			await expect(editor.getBlock(1)).toHaveText(expected);
		}
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForBlockCount(2);
		// The extra blank line is the editor's plain merge-an-emptied-middle-block
		// shape (reproducible with no widget in the document); what this pins is that
		// `[^a]` is gone from the merged bytes rather than resurrected.
		expect(await editor.bridge.getSource()).toBe('above\n\n\n[^a]: note\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

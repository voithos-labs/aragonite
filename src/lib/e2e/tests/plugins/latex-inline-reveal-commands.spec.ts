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

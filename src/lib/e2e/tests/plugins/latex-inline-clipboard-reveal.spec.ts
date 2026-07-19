import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * A clipboard mutation during an active inline-math source reveal must fold the
 * reveal into the CST before mutating — the reveal-fold clipboard seam. Pre-fix,
 * paste spliced into the stale raw at a DOM-derived offset and the re-render wiped
 * the revealed edit while the reveal flag stayed stuck, dropping every later
 * keystroke. The reveal-fold return value is unit-adjacent (widget-interaction);
 * this drives the real reveal + synthetic paste to prove the committed source
 * carries the revealed edit AND that typing survives the paste.
 */

class MathClipboardPage extends PluginsPage {
	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}

	async gotoMath(): Promise<void> {
		await this.gotoPlugins('math');
		await expect(this.mathWidget).toHaveCount(1);
	}

	/** Reveal `$x^2$` at its trailing edge: click the block, End, then ArrowLeft
	 *  through " after" (6 chars) to reach raw offset 12, then ArrowLeft to enter. */
	async revealAtTrailingEdge(): Promise<void> {
		await this.getBlock(0).click();
		await this.page.keyboard.press('End');
		for (let i = 0; i < 6; i++) await this.page.keyboard.press('ArrowLeft');
		await this.page.keyboard.press('ArrowLeft');
		await expect(this.mathWidget).toHaveCount(0);
	}

	/** Fire a real paste event carrying `text` at the focused block. */
	async pastePlainText(text: string): Promise<void> {
		await this.page.evaluate((value) => {
			const dt = new DataTransfer();
			dt.setData('text/plain', value);
			document.activeElement?.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })
			);
		}, text);
	}
}

test.describe('inline math: clipboard during an active source reveal', () => {
	let editor: MathClipboardPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathClipboardPage(page);
		await editor.gotoMath();
	});

	test('paste folds the reveal first, keeping the revealed edit and later typing alive', async ({
		page
	}) => {
		await editor.revealAtTrailingEdge();

		// Two chars edit the revealed source (onInput suppressed — not yet in the CST).
		await page.keyboard.type('QQ');

		await editor.pastePlainText('P');

		// The fold committed the revealed `QQ` to the CST — the exact splice-consistency
		// the guard restores. Pre-fix this never lands (the re-render wiped it).
		await editor.bridge.waitForSourceContains('QQ');

		// Typing is no longer suppressed: the fold cleared the reveal flag.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z');

		const source = await editor.bridge.getSource();
		expect(source).toContain('QQ');
		expect(source).toContain('P');
		expect(source).toContain('Z');
		// No wrong-offset splice into the widget: the math delimiters survive intact.
		expect(source).toContain('$x^2$');
	});

	test('copy reads the revealed live-DOM edit and never folds the reveal', async ({ page }) => {
		await editor.revealAtTrailingEdge();

		// Edit the revealed source (onInput suppressed — the edit is DOM-only).
		await page.keyboard.type('QQ');

		// Select the edit; both endpoints stay inside the source node, so the copy
		// never trips the escape-fold.
		await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('Shift+ArrowLeft');

		await page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		const clip = await page.evaluate(() => navigator.clipboard.readText());
		// The clipboard holds exactly what the user selected and SEES — the live DOM
		// edit — not the stale raw slice, which never carried `QQ` (uncommitted edit).
		expect(clip).toBe('QQ');

		// Copy never mutates: the reveal stays open (widget still folded to source)…
		await expect(editor.mathWidget).toHaveCount(0);
		// …and the document is untouched — `QQ` never reached the CST.
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('QQ');
		expect(source).toContain('$x^2$');
	});
});

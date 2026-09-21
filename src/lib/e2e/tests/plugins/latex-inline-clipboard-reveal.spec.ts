import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * A clipboard edit while an inline formula's source is open must commit that source into the CST
 * first. Without it, a paste splices into the stale raw at an offset derived from the DOM, the
 * re-render wipes the edit on screen, and a flag left set drops every later keystroke. This drives
 * the real gesture plus a fired paste to prove the committed source carries the edit and that
 * typing survives the paste.
 */

class MathClipboardPage extends PluginsPage {
	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}

	async gotoMath(): Promise<void> {
		await this.gotoPlugins('math');
		await expect(this.mathWidget).toHaveCount(1);
	}

	/** Open `$x^2$` at its trailing edge: click the block, End, then ArrowLeft through the 6
	 *  characters of " after" to reach raw offset 12, then one more ArrowLeft to enter. */
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

		// Two characters edit the open source; onInput is suppressed, so nothing is in the CST.
		await page.keyboard.type('QQ');

		await editor.pastePlainText('P');

		// Closing the source committed `QQ` to the CST, so the paste splices into current bytes.
		await editor.bridge.waitForSourceContains('QQ');

		// Typing works again: closing the source cleared the flag.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z');

		const source = await editor.bridge.getSource();
		expect(source).toContain('QQ');
		expect(source).toContain('P');
		expect(source).toContain('Z');
		// Nothing was spliced at a wrong offset: the maths delimiters survive intact.
		expect(source).toContain('$x^2$');
	});

	test('copy reads the revealed live-DOM edit and never folds the reveal', async ({ page }) => {
		await editor.revealAtTrailingEdge();

		// Edit the open source; onInput is suppressed, so the edit is in the DOM only.
		await page.keyboard.type('QQ');

		// Select the edit; both endpoints stay inside the source node, so the copy never closes it.
		await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('Shift+ArrowLeft');

		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		const clip = await editor.readClipboard();
		// The clipboard holds exactly what the user selected and sees, the live DOM text, not the
		// stale raw slice, which never held the uncommitted `QQ`.
		expect(clip).toBe('QQ');

		// Copy never edits: the source stays open, with the widget still swapped out…
		await expect(editor.mathWidget).toHaveCount(0);
		// …and the document is untouched, since `QQ` never reached the CST.
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('QQ');
		expect(source).toContain('$x^2$');
	});
});

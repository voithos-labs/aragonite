import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { capturedErrors } from '../plugins/helpers';
import { MathRevealPage } from '../plugins/latex-reveal-helpers';

// A flip is a blur-class event, so an open source reveal folds through the same choke point on
// EVERY flip, and early enough that the mode's render key has not yet rebuilt the block out from
// under the reveal's ephemeral edit (E-F4).
// Requirements: e2e/requirements/presentation/presentation-mode-flip-fold.md.

const DOC = 'above\n\n$x^2$\n';

test.describe('mode flips — an open reveal folds', () => {
	let editor: MathRevealPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathRevealPage(page);
		await editor.gotoPlugins('math');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
		await editor.loadContent(DOC);
	});

	async function flipTo(page: Page, mode: string): Promise<void> {
		await page.evaluate((m) => (window as any).__test.setPresentationMode(m), mode);
		await editor.waitForRenderFlush();
	}

	/** Open the reveal and type one byte into the formula; the CST is still behind at this point. */
	async function revealAndEdit(page: Page): Promise<void> {
		await editor.revealFromTrailingEdge(1);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('q');
		await expect(editor.getBlock(1)).toHaveText('$x^2q$');
		expect(await editor.bridge.getSource(), 'the reveal holds its bytes').toBe(DOC);
	}

	for (const mode of ['live', 'reading']) {
		test(`the flip to ${mode} commits the edit the reveal was holding`, async ({ page }) => {
			await revealAndEdit(page);
			await flipTo(page, mode);
			expect(await editor.bridge.getSource()).toBe('above\n\n$x^2q$\n');
			expect(await capturedErrors(page)).toEqual([]);
		});
	}

	// The other half of the fold rule: a reveal with nothing typed into it commits nothing, so the
	// flip stays byte-neutral like every other flip.
	test('a reveal opened but not edited writes nothing across the flip', async ({ page }) => {
		await editor.revealFromTrailingEdge(1);
		await flipTo(page, 'live');
		expect(await editor.bridge.getSource()).toBe(DOC);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

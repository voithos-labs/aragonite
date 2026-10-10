import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { capturedErrors } from '../plugins/helpers';
import { MathRevealPage } from '../plugins/latex-reveal-helpers';
import type { PresentationMode } from '../../../presentation-mode';

// A mode change counts as a blur, so a block showing its source collapses through the same one
// place on every switch, before the mode's render key rebuilds the block out from under its edit.
// Requirements: e2e/requirements/presentation/presentation-mode-flip-fold.md.

const DOC = 'above\n\n$x^2$\n';

test.describe('mode flips: an open reveal folds', () => {
	let editor: MathRevealPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathRevealPage(page);
		await editor.gotoPlugins('math');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
		await editor.loadContent(DOC);
	});

	async function flipTo(mode: PresentationMode): Promise<void> {
		await editor.setPresentationMode(mode);
		await editor.waitForRenderFlush();
	}

	/** Show the source and type one byte into the formula; the CST has not caught up yet. */
	async function revealAndEdit(page: Page): Promise<void> {
		await editor.revealFromTrailingEdge(1);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('q');
		await expect(editor.getBlock(1)).toHaveText('$x^2q$');
		expect(await editor.bridge.getSource(), 'the reveal holds its bytes').toBe(DOC);
	}

	for (const mode of ['live', 'reading'] as const) {
		test(`the flip to ${mode} commits the edit the reveal was holding`, async ({ page }) => {
			await revealAndEdit(page);
			await flipTo(mode);
			expect(await editor.bridge.getSource()).toBe('above\n\n$x^2q$\n');
			expect(await capturedErrors(page)).toEqual([]);
		});
	}

	// The other half of the same rule: a source shown but not typed into commits nothing, so the
	// mode change moves no byte, like every other one.
	test('a reveal opened but not edited writes nothing across the flip', async ({ page }) => {
		await editor.revealFromTrailingEdge(1);
		await flipTo('live');
		expect(await editor.bridge.getSource()).toBe(DOC);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

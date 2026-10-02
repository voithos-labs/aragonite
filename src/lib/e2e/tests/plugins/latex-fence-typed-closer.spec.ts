import { test, expect } from '../../fixtures';
import { roundTripStable } from './helpers';
import { BlockMathPage } from './latex-reveal-helpers';

// A body line typed into a ```math source that reads as the fence's closer grows the fence when
// the source is committed, as it does in a code block, instead of splitting the block in two.
// Requirements: e2e/requirements/plugins/latex-fence-typed-closer.md.

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode} mode: a closer-shaped line typed into a math fence`, () => {
		test('grows both fence runs on commit and keeps one math block', async ({ page }) => {
			const editor = new BlockMathPage(page);
			await editor.gotoMathSeed('mathfence');
			await editor.setPresentationMode(mode);

			await editor.revealFromBefore();
			// Onto the body line, whichever line the arrival left the caret on, then its end.
			if (mode === 'source') await page.keyboard.press('ArrowDown');
			await page.keyboard.press('End');
			await page.keyboard.press('Enter');
			await editor.typeSlowly('```');
			await expect.poll(() => editor.sourceText()).toBe('```math\nx^2\n```\n```');

			await editor.getBlock(2).click();
			await editor.bridge.waitForSourceEquals('Before\n\n````math\nx^2\n```\n````\n\nAfter\n');
			expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
			expect(await roundTripStable(page)).toBe(true);
		});
	});
}

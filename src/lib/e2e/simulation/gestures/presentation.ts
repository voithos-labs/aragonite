import type { SimContext } from '../invariants';

/**
 * The byte-stability oracle for the mode prop: the source must round-trip unchanged across a
 * `source → mode → source` flip regardless of what was live when it landed, which the closing
 * `waitForSourceEquals` asserts. Reading mode drops the text caret, so the return trip
 * re-clicks a block to hand the following gestures an editable surface.
 */
type FlipMode = 'reading' | 'preview-block' | 'preview-inline';

const TOGGLE_TESTID: Record<FlipMode, string> = {
	reading: 'presentation-toggle',
	'preview-block': 'preview-block-toggle',
	'preview-inline': 'preview-inline-toggle'
};

export async function flipPresentationMode(ctx: SimContext, mode: FlipMode): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const toggle = page.getByTestId(TOGGLE_TESTID[mode]);

	await toggle.click();
	await page.waitForSelector(`.editor[data-presentation="${mode}"]`, { timeout: 2000 });

	await toggle.click();
	await page.waitForSelector('.editor:not([data-presentation])', { timeout: 2000 });

	// Reading left no caret; restore an editable surface before handing control back.
	await editor.clickBlock(0);
	await editor.bridge.waitForSourceEquals(before, 3000);
	tracker.resync(before);
}

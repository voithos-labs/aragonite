import type { SimContext } from '../invariants';

/**
 * The check that the mode prop changes no bytes: the source must come back unchanged from a switch
 * out and back, whatever state the editor was in.
 */
type FlipMode = 'reading' | 'preview-block' | 'preview-inline' | 'live';

const TOGGLE_TESTID: Record<FlipMode, string> = {
	reading: 'presentation-toggle',
	'preview-block': 'preview-block-toggle',
	'preview-inline': 'preview-inline-toggle',
	live: 'live-toggle'
};

export async function flipPresentationMode(ctx: SimContext, mode: FlipMode): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const toggle = page.getByTestId(TOGGLE_TESTID[mode]);

	await toggle.click();
	await page.waitForSelector(`.editor[data-presentation="${mode}"]`, { timeout: 5000 });

	await toggle.click();
	await page.waitForSelector('.editor:not([data-presentation])', { timeout: 5000 });

	// Reading mode left no caret; put one back in an editable block before returning.
	await editor.clickBlock(0);
	await editor.bridge.waitForSourceEquals(before, 3000);
	tracker.resync(before);
}

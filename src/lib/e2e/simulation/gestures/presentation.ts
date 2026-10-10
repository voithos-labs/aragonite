import type { SimContext } from '../invariants';
import type { FlipMode } from '../detour-plan';
import { clickModeToggle } from '../../mode-switch';

/**
 * The check that the mode prop changes no bytes: the source must come back unchanged from a switch
 * out and back, whatever state the editor was in.
 */
export async function flipPresentationMode(ctx: SimContext, mode: FlipMode): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	await clickModeToggle(page, mode);
	await clickModeToggle(page, mode);

	// Reading mode left no caret; put one back in an editable block before returning.
	await editor.clickBlock(0);
	await editor.bridge.waitForSourceEquals(before, 3000);
	tracker.resync(before);
}

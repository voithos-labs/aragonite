import { type SimContext } from '../invariants';

// Where the caret sits, in raw offsets, and the arrow presses that walk it there. The widget
// gestures check exact positions, so the caret has to arrive by presses a user would make.
// `live-editing.ts` keeps its own version, which counts offsets along the selection path.

export async function cursorOffset(ctx: SimContext, blockIndex: number): Promise<number | null> {
	return ctx.page.evaluate(
		(i) => (window as any).__test.getBlockCursorSurface([i]).cursorOffset,
		blockIndex
	);
}

// A step over a widget lands the caret exactly on its far edge, so every reachable offset is
// hit exactly and a step past `target` throws rather than looping forever.
export async function arrowRightToOffset(
	ctx: SimContext,
	blockIndex: number,
	target: number
): Promise<void> {
	await ctx.editor.focusBlockStart(blockIndex);
	for (let guard = 0; guard <= target + 8; guard++) {
		if ((await cursorOffset(ctx, blockIndex)) === target) return;
		await ctx.page.keyboard.press('ArrowRight');
	}
	throw new Error(
		`[${ctx.label}] could not land the caret at raw offset ${target} in block ${blockIndex} ` +
			`(reached ${await cursorOffset(ctx, blockIndex)})`
	);
}

import { type SimContext } from '../invariants';

// Where the caret sits in RAW offsets, and the real-arrow walk that puts it there. The atomic
// widget gestures assert exact landings, so the caret has to arrive by presses a user makes.
// `live-editing.ts`'s seatCaret stays separate: it walks selection-path offsets, another space.

export async function cursorOffset(ctx: SimContext, blockIndex: number): Promise<number | null> {
	return ctx.page.evaluate(
		(i) => (window as any).__test.getBlockCursorSurface([i]).cursorOffset,
		blockIndex
	);
}

// An atomic step-over lands the caret exactly on a far edge, so every reachable offset is hit
// exactly and an over-step past `target` trips the guard rather than looping forever.
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

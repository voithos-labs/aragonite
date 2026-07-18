import { type SimContext, assertStructuralIntegrity } from '../invariants';

/**
 * Backspace-at-offset-0 merge gestures — the merge-rules subsystem the corruption
 * oracle otherwise never drives. Backspace at the start of a block either MERGES it
 * into its predecessor (para→para, para→heading absorber, para→container deepest
 * leaf) or, for a container's first child, DELEGATES to the container-exit unwrap
 * (list U1, blockquote U2). Which one fires depends on the block kinds — the gesture
 * stays agnostic and asserts only that a real structural change happened. Backspace
 * at the document's first block has no predecessor and is a no-op, so a caller that
 * targets it fails loudly rather than recording a stale tree.
 *
 * `targetPath` addresses the block whose start receives the Backspace; the click
 * resolves it to the first editable in that block's subtree, so a container path
 * lands the caret in its first leaf (where the exit-delegation Backspace belongs).
 */
export async function mergeBackspaceAtStart(ctx: SimContext, targetPath: number[]): Promise<void> {
	const { editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	await editor.clickBlockAtPath(targetPath, 0);
	await editor.page.keyboard.press('Home');
	await editor.waitForRenderFlush();
	await editor.page.keyboard.press('Backspace');
	await editor.bridge
		.waitForSourceWith((source, prior) => source !== prior, before)
		.catch(() => {
			throw new Error(
				`[${ctx.label}] merge Backspace at start of ${JSON.stringify(targetPath)} left the ` +
					`source unchanged — no predecessor to merge into, or the key fell through.\n` +
					`SOURCE: ${JSON.stringify(before)}`
			);
		});
	await assertStructuralIntegrity(ctx);
	tracker.resync(await editor.bridge.getSource());
}

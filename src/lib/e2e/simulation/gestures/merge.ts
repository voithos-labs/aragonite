import { type SimContext, assertStructuralIntegrity } from '../invariants';

/**
 * The merge-rules subsystem the corruption oracle otherwise never drives. Which of merge or
 * container-exit unwrap fires depends on the block kinds, so the gesture stays AGNOSTIC and
 * asserts only that a real structural change happened; the document's first block has no
 * predecessor, so targeting it fails loudly rather than recording a stale tree. `targetPath`
 * resolves to the first editable in its subtree, where the exit-delegation Backspace belongs.
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

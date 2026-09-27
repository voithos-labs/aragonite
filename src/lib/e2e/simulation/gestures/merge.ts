import { type SimContext, assertStructuralIntegrity } from '../invariants';

/**
 * The merge rules, which nothing else in the simulation drives. Whether the block merges or leaves
 * its container depends on the kinds, so this only checks that the structure changed. Aiming at
 * the document's first block throws, since nothing sits above it.
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
					`source unchanged: no predecessor to merge into, or the key fell through.
` +
					`SOURCE: ${JSON.stringify(before)}`
			);
		});
	await assertStructuralIntegrity(ctx);
	tracker.resync(await editor.bridge.getSource());
}

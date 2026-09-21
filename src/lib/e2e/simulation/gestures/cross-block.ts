import { type SimContext, assertStructuralIntegrity } from '../invariants';

/**
 * Deleting across blocks, where the worst corruption bugs came from. Building a range must
 * really cross a block boundary and throw loudly if it quietly stayed inside one, so nothing
 * that did nothing counts as coverage; deleting one waits for the source to change, runs the
 * structural checks on the collapsed tree, then resyncs.
 */

// ── Build ──────────────────────────────────────────────────────────────────────

async function assertCrossBlockEngaged(ctx: SimContext, how: string): Promise<void> {
	const [domActive, stateActive] = await Promise.all([
		ctx.editor.bridge.isCrossBlockActive(),
		ctx.page.evaluate(() => (window as any).__test.isCrossBlockSelection())
	]);
	if (!domActive || !stateActive) {
		const sel = await ctx.editor.bridge.getSelectionPaths();
		throw new Error(
			`[${ctx.label}] cross-block build (${how}) did not engage a cross-block selection: ` +
				`dom=${domActive} state=${stateActive}\nSELECTION: ${JSON.stringify(sel)}`
		);
	}
}

/**
 * A one-line block is crossed in a single press and a wrapped one may need more, so this
 * presses up to `maxSteps` until the cross-block attribute appears, then checks that it did.
 */
export async function extendSelectionAcross(
	ctx: SimContext,
	dir: 'down' | 'up',
	maxSteps = 6
): Promise<void> {
	const key = dir === 'down' ? 'Shift+ArrowDown' : 'Shift+ArrowUp';
	let engaged = false;
	for (let i = 0; i < maxSteps && !engaged; i++) {
		await ctx.page.keyboard.press(key);
		await ctx.editor.waitForRenderFlush();
		engaged = await ctx.editor.bridge.isCrossBlockActive();
	}
	await assertCrossBlockEngaged(ctx, `shift-${dir}`);
}

/** Shift+Click into another block to extend a cross-block selection to it. */
export async function shiftClickAcross(
	ctx: SimContext,
	targetPath: number[],
	offset: number
): Promise<void> {
	await ctx.editor.shiftClickBlock(targetPath, offset);
	await assertCrossBlockEngaged(ctx, `shift-click ${JSON.stringify(targetPath)}`);
}

/**
 * Ctrl+A twice: the block, then the whole document. A one-block document never widens, so this
 * checks the range crossed a boundary and throws if the second press stayed inside one block.
 */
export async function selectWholeDocument(ctx: SimContext): Promise<void> {
	await ctx.editor.selectAll();
	await ctx.editor.waitForRenderFlush();
	await ctx.editor.selectAll();
	await ctx.editor.waitForRenderFlush();
	await assertCrossBlockEngaged(ctx, 'double-select-all');
}

// ── Destroy ────────────────────────────────────────────────────────────────────

/**
 * Waits for the selection to collapse and for the source to really change, so a delete that
 * quietly did nothing (the range never crossed a block, the key was ignored) fails here rather
 * than recording a stale tree.
 */
async function destroyThenSweep(
	ctx: SimContext,
	act: () => Promise<void>,
	how: string
): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	const wasCrossBlock = await ctx.editor.bridge.isCrossBlockActive();
	await act();
	if (wasCrossBlock) await ctx.editor.waitForCrossBlock(false);
	await ctx.editor.bridge
		.waitForSourceWith((source, prior) => source !== prior, before)
		.catch(() => {
			throw new Error(
				`[${ctx.label}] destroy (${how}) left the source unchanged — the selection ` +
					`never engaged or the key fell through.\nSOURCE: ${JSON.stringify(before)}`
			);
		});
	await assertStructuralIntegrity(ctx);
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

export function deleteSelection(ctx: SimContext, key: 'Backspace' | 'Delete'): Promise<void> {
	return destroyThenSweep(ctx, () => ctx.page.keyboard.press(key), key);
}

export function cutSelection(ctx: SimContext): Promise<void> {
	return destroyThenSweep(ctx, () => ctx.page.keyboard.press('ControlOrMeta+x'), 'cut');
}

export function typeOverSelection(ctx: SimContext, text: string): Promise<void> {
	return destroyThenSweep(
		ctx,
		() => ctx.editor.typeSlowly(text),
		`type-over ${JSON.stringify(text)}`
	);
}

export function pasteOverSelection(ctx: SimContext): Promise<void> {
	return destroyThenSweep(ctx, () => ctx.page.keyboard.press('ControlOrMeta+v'), 'paste-over');
}

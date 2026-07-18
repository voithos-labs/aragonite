import { primaryModifier } from '../../platform';
import { type SimContext, assertStructuralIntegrity } from '../invariants';

/**
 * Cross-block selection gestures — the destructive surface that held the historical
 * corruption Criticals and the invisible-selection bug. Split into BUILD gestures
 * (real Shift+Arrow / Shift+Click / double select-all that must ENGAGE a genuine
 * cross-block range — a build that silently stays single-block fails loudly here so
 * a no-op is never mistaken for coverage) and DESTROY gestures (Backspace/Delete,
 * type-over, paste-over, Cut over the live range). Every destroy is editor
 * auto-behavior — a range collapse plus a merge — so it settles on a real source
 * change, runs the structural oracle sweep on the collapsed tree, then resyncs the
 * model-free tracker from the observed source.
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
 * Extend the selection across the block boundary below/above the caret with real
 * Shift+ArrowDown/Up presses. The caret must already sit in a block; a single-line
 * block crosses in one press, a wrapped one may need more, so this presses up to
 * `maxSteps` until the cross-block attribute attaches, then asserts engagement.
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
 * Select the whole document with a double Ctrl+A: the first press selects the caret's
 * block, the second escalates to every block — the widest cross-block range there is.
 * A single-block document never escalates, so this asserts engagement and fails loud
 * if the second press stayed within one block.
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
 * Destroy the live selection with `act`, settle on the collapse + a real source
 * change, then run the structural oracle sweep and resync. A destroy that silently
 * no-ops (the range never engaged, the key fell through to the origin block) leaves
 * the source unchanged and fails here rather than recording a stale tree as truth.
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
	return destroyThenSweep(ctx, () => ctx.page.keyboard.press(`${primaryModifier}+x`), 'cut');
}

export function typeOverSelection(ctx: SimContext, text: string): Promise<void> {
	return destroyThenSweep(
		ctx,
		() => ctx.editor.typeSlowly(text),
		`type-over ${JSON.stringify(text)}`
	);
}

export function pasteOverSelection(ctx: SimContext): Promise<void> {
	return destroyThenSweep(ctx, () => ctx.page.keyboard.press(`${primaryModifier}+v`), 'paste-over');
}

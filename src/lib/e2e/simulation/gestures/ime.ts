import { type SimContext } from '../invariants';

// A composition writes to the DOM but not to the source until it commits, so mid-composition
// there is no source change to wait on: `compose` waits on the DOM text, the commit on the
// bytes reaching the source. The driver comes in on `ctx.ime`, made once per session; the
// gestures throw loudly if it is absent.

export interface CompositionCase {
	/** The candidate strings shown while composing, applied in order. */
	readonly updates: readonly string[];
	/** The committed text (a converted candidate, e.g. かん → 日本). */
	readonly commit: string;
}

function requireIme(ctx: SimContext): NonNullable<SimContext['ime']> {
	const ime = ctx.ime;
	if (!ime) throw new Error(`[${ctx.label}] IME gesture ran without a threaded CDP driver`);
	return ime;
}

/**
 * Checks the source stays byte for byte the same through every update while composing, then
 * waits for the committed bytes. Focused at the end of the block, so the commit adds to the end
 * of it rather than in the middle of a word.
 */
export async function composeCommit(
	ctx: SimContext,
	blockIndex: number,
	composition: CompositionCase
): Promise<void> {
	const { editor, tracker } = ctx;
	const ime = requireIme(ctx);
	await editor.focusBlockEnd(blockIndex);
	const before = await editor.bridge.getSource();

	for (const update of composition.updates) {
		await ime.compose(update);
		if ((await editor.bridge.getSource()) !== before) {
			throw new Error(
				`[${ctx.label}] the source changed mid-composition — the compose window must stay ` +
					`DOM-only until commit.\nBEFORE: ${JSON.stringify(before)}`
			);
		}
	}

	await ime.commit(composition.commit);
	await editor.bridge.waitForSourceContains(composition.commit);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * An empty insert ends the composition without writing anything, so the source must be
 * identical before and after: an abandoned composition commits nothing.
 */
export async function composeAbort(
	ctx: SimContext,
	blockIndex: number,
	composition: CompositionCase
): Promise<void> {
	const { editor, tracker } = ctx;
	const ime = requireIme(ctx);
	await editor.focusBlockEnd(blockIndex);
	const before = await editor.bridge.getSource();

	for (const update of composition.updates) await ime.compose(update);
	await ime.abort();
	// Composition is driven over CDP, not by keys, so the abort fires no keydown for the editor
	// to record a decision about.
	await editor.waitForNoSourceMutation();
	if ((await editor.bridge.getSource()) !== before) {
		throw new Error(
			`[${ctx.label}] an aborted composition changed the source.\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER: ${JSON.stringify(await editor.bridge.getSource())}`
		);
	}
	tracker.resync(before);
}

import { type SimContext } from '../invariants';

// IME composition gestures on the perform → settle → resync pattern. A
// composition writes to the focused element's DOM but not to the source until it
// commits, so there is no source delta to settle on mid-composition — `compose`
// settles on the composed text arriving in the DOM (handled by the ImeDriver),
// and the commit settles on the composed bytes reaching the source. The tracker
// resyncs around the commit; a multibyte insert is never an end-of-doc append the
// printable rule could predict. The driver is threaded through `ctx.ime`, created
// once per session from a CDP surface — the gestures throw loudly if it is absent.

export interface CompositionCase {
	/** In-flight composition strings, applied in order (the pre-edit candidates). */
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
 * Compose a multibyte candidate through progressive updates, then commit it, at
 * the caret in `blockIndex`. Asserts the source stays byte-stable across every
 * mid-composition update (the compose window is DOM-only), then settles on the
 * committed bytes reaching the source and resyncs. The block is focused at its end
 * so the commit appends within the block, not at a mid-word boundary.
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
 * Compose a candidate, then abort it (an empty insert ends the composition with
 * no bytes) — net identity. The source must be byte-identical before and after,
 * proving an abandoned composition commits nothing. Resyncs to the unchanged
 * source.
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
	await editor.waitForNoSourceMutation();
	if ((await editor.bridge.getSource()) !== before) {
		throw new Error(
			`[${ctx.label}] an aborted composition changed the source.\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER: ${JSON.stringify(await editor.bridge.getSource())}`
		);
	}
	tracker.resync(before);
}

import type { Page } from '@playwright/test';
import type { EditorPage } from '../editor-page';
import { makeRng, type Rng } from './rng';
import { ExpectationTracker } from './expectation';
import { attachErrorCollector } from './error-collector';
import { Gestures } from './gestures';
import { Recorder, runDirForSeed } from './recorder';
import type { NoteFixture } from './notes/types';
import {
	type SimContext,
	assertContainsInOrder,
	assertContainerParity,
	assertEndState,
	assertNestedStateConsistent,
	assertNoErrors,
	assertParseConvergence,
	assertRoundTripStable,
	assertSelectionValidity,
	undoRedoDifferential
} from './invariants';

export interface SessionOpts {
	seed: number;
	note: NoteFixture;
	capture?: boolean;
	/**
	 * Run the whole-session undo-unwind oracle after the build. Off by default — it
	 * drives one undo/redo per stack entry, so it is wired into the smoke note and a
	 * single multi-seed seed rather than every session.
	 */
	undoUnwind?: boolean;
}

const EMPTY_BASELINE = '\n';

/**
 * Drives one full note-taking session through real gestures and runs the
 * oracle suite continuously. The canonical end-state target is computed up
 * front by loading the note's markdown (typing ≡ loading), then the editor is
 * cleared to the empty baseline to begin authoring. Never call `loadContent(x)`
 * when the prop already holds `x` — the test route's `setSource` is a no-op on
 * an unchanged value, so the two-hop start sequence below (showcase → markdown
 * → empty) relies on each hop being a real value change.
 */
export async function runSession(page: Page, editor: EditorPage, opts: SessionOpts): Promise<void> {
	const errors = attachErrorCollector(page);
	await errors.start();

	await editor.loadContent(opts.note.expectedMarkdown);
	const canonical = await editor.bridge.getSource();

	await editor.loadContent('');
	const baseline = await editor.bridge.getSource();
	if (baseline !== EMPTY_BASELINE) {
		throw new Error(
			`CALIBRATION FAILURE: empty baseline is ${JSON.stringify(baseline)}, ` +
				`expected ${JSON.stringify(EMPTY_BASELINE)}. The tracker insert rule and the ` +
				`baseline assumption both depend on this — stop and recalibrate.`
		);
	}

	await editor.clickBlock(0);

	const tracker = new ExpectationTracker(baseline);
	const ctx: SimContext = { page, editor, tracker, errors, label: 'session' };
	const rng = makeRng(opts.seed);

	const recorder = opts.capture ? new Recorder(page, editor, runDirForSeed(opts.seed)) : null;
	const g = new Gestures(ctx, rng, {
		typoRate: 0.15,
		onCheckpoint: recorder ? (label, gesture) => recorder.checkpoint(label, gesture) : undefined
	});

	ctx.label = 'build';
	await opts.note.build(g);

	// Finalize the capture manifest in a `finally` so that if any oracle throws
	// mid-session, the screenshots + state dumps gathered up to that point still
	// land for the visual review — then the failure re-throws, never masked.
	try {
		ctx.label = 'checkpoint';
		await assertNoErrors(ctx);
		await assertNestedStateConsistent(ctx);
		await assertContainerParity(ctx);
		await assertRoundTripStable(ctx);
		await assertSelectionValidity(ctx);
		await assertParseConvergence(ctx, opts.note);
		await assertContainsInOrder(ctx, opts.note.landmarks);
		await recorder?.checkpoint('note-built', 'build');

		// Whole-session undo integrity: unwind the entire authoring stack to its floor
		// and rewind it. Placed here, not at note end, because it needs an empty redo
		// stack — the net-identity detours below each close with an undo that leaves
		// dangling redo residue, which would make "rewind to the top" ill-defined.
		if (opts.undoUnwind) {
			ctx.label = 'undo-unwind';
			await runFullSessionUndoUnwind(ctx, baseline);
		}

		ctx.label = 'jump-back-detour';
		await g.lateCorrection([0]);
		await recorder?.checkpoint('detour-done', 'jump-back');

		ctx.label = 'cancelling-detours';
		await runCancellingDetours(ctx, g, rng, opts.note);

		ctx.label = 'undo-redo-differential';
		await runRevertingDifferential(ctx);

		ctx.label = 'end-state';
		await assertNoErrors(ctx);
		await assertContainerParity(ctx);
		await assertRoundTripStable(ctx);
		await assertSelectionValidity(ctx);
		await assertParseConvergence(ctx, opts.note);
		await assertEndState(ctx, canonical);
	} finally {
		await recorder?.finalize();
	}
}

/**
 * Validate exact undo + redo around a transient edit, then drop the edit so the
 * note returns to its clean built state — the differential must not leave a
 * residual char that would fail the end-state equality oracle.
 */
async function runRevertingDifferential(ctx: SimContext): Promise<void> {
	const clean = await ctx.editor.bridge.getSource();
	await undoRedoDifferential(ctx, async () => {
		await ctx.editor.typeSlowly('X');
		// Confirm the keystroke landed via a source delta, not a content match: a
		// `waitForSourceContains('X')` would false-pass on any note whose source
		// already contains an 'X'.
		await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, clean, 2000);
	});
	await ctx.editor.undo();
	await ctx.editor.bridge.waitForSourceEquals(clean, 3000);
	ctx.tracker.resync(clean);
}

/**
 * Seeded realism detours that each NET TO IDENTITY: a user pausing, then noticing a
 * stray earlier edit and reverting it. Every detour restores the exact pre-detour
 * source (asserted before continuing), so the end-state equality oracle still holds
 * for every note and seed. The seed gates which fire, so different seeds exercise
 * different undo-batch shapes — the multi-seed runner fuzzes those interleavings.
 *
 * The `pause()`s are the load-bearing piece, not decoration: each flushes the input
 * batcher so the delete that follows lands in its own undo entry. Without the fence
 * a single Ctrl+Z could overshoot into the prior edit's batch and miss the restore.
 */
async function runCancellingDetours(
	ctx: SimContext,
	g: Gestures,
	rng: Rng,
	note: NoteFixture
): Promise<void> {
	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.7)) {
		await selectDeleteUndoDetour(ctx, g, rng);
	}

	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.5)) {
		await copyPasteUndoDetour(ctx, g);
	}

	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.7)) {
		await reorderUndoDetour(ctx, g);
	}

	if (rng.chance(0.5)) await g.pause();

	// Byte-stability across a presentation-mode flip. The seed picks which rung so the
	// multi-seed runner spreads reading / preview-block / preview-inline across seeds —
	// the flip must not perturb the clean built source under any live gesture state.
	if (rng.chance(0.7)) {
		await g.flipPresentationMode(rng.pick(['reading', 'preview-block', 'preview-inline'] as const));
	}

	// The two most dangerous surfaces, appended so the existing seed→detour mapping is
	// preserved. Both net to identity via a trailing undo, so end-state equality holds.
	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.6)) {
		await crossBlockDestroyUndoDetour(ctx, g, rng, note);
	}

	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.6)) {
		await mergeUndoDetour(ctx, g, note);
	}
}

/**
 * Move the title block down a position, then undo — net identity. This drives a
 * reorder BETWEEN edits and undo/redo, the interleaving that surfaces the
 * aliasing/unshare/stamp corruption a reorder can introduce (the simulation is the
 * only oracle that catches that class — `docs/contributing/culture.md` § Testing
 * shape). Block 0 is a heading or paragraph in every note and every note has a
 * sibling below it, so the move is never a no-op; the closing assertion proves the
 * single undo restores byte-exact.
 */
async function reorderUndoDetour(ctx: SimContext, g: Gestures): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await g.pause();
	await g.reorder(0, 1);
	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

/**
 * Click into the title block, select a few chars from end-of-line, Delete them, then
 * undo. Block 0 is a heading or paragraph in every note, so `End` + a small leftward
 * selection always has chars to remove. The pre-delete `pause` fences the delete into
 * its own undo batch so one Ctrl+Z reverses exactly it; the closing assertion proves
 * the restore is byte-exact (a failure here would be a real undo bug, not a flake).
 */
async function selectDeleteUndoDetour(ctx: SimContext, g: Gestures, rng: Rng): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await g.pause();
	await g.clickToReposition([0], 0);
	await ctx.page.keyboard.press('End');
	await g.selectAndDelete(rng.int(3, 6));
	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

/**
 * Copy a few chars from the title, paste them at the caret, then undo the paste —
 * net identity. Like the delete detour it fences with `pause` and asserts byte-exact
 * restoration. Copy/paste leaves the clipboard dirty but the source unchanged once
 * the paste is undone, which is all the end-state oracle observes.
 */
async function copyPasteUndoDetour(ctx: SimContext, g: Gestures): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await g.pause();
	await g.clickToReposition([0], 0);
	await ctx.page.keyboard.press('End');
	await g.selectChars(4);
	await g.copySelection();
	await ctx.page.keyboard.press('End');
	await g.pasteHere();
	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

/**
 * Build a cross-block selection over the first two top-level blocks with real input,
 * destroy over it, then undo — net identity. Cross-block destruction is the surface
 * that held the historical corruption Criticals; driving it here puts a range collapse
 * + merge under the full oracle sweep on every seed, and the closing undo proves the
 * collapse is byte-reversible. The seed picks the build (Shift+Arrow / Shift+Click /
 * double select-all) and the destroy (Backspace / Delete / Cut / type-over /
 * paste-over) so seeds spread across the entry×exit matrix. Convergence rides the
 * caller (it carries the note's waiver); the gesture's own sweep covers the rest.
 */
async function crossBlockDestroyUndoDetour(
	ctx: SimContext,
	g: Gestures,
	rng: Rng,
	note: NoteFixture
): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	const destroy = rng.pick(['backspace', 'delete', 'cut', 'type-over', 'paste-over'] as const);
	await g.pause();

	// paste-over needs a primed clipboard; copy from block 0 before the range is built
	// (the copy collapses whatever is selected, so it must precede the cross-block build).
	if (destroy === 'paste-over') {
		await g.clickToReposition([0], 0);
		await ctx.page.keyboard.press('End');
		await g.selectChars(3);
		await g.copySelection();
	}

	await g.clickToReposition([0], 0);
	await ctx.page.keyboard.press('End');

	const build = rng.pick(['shift-down', 'shift-click', 'select-all'] as const);
	if (build === 'shift-down') await g.extendSelectionAcross('down');
	else if (build === 'shift-click') await g.shiftClickAcross([1], 1);
	else await g.selectWholeDocument();

	if (destroy === 'backspace') await g.deleteSelection('Backspace');
	else if (destroy === 'delete') await g.deleteSelection('Delete');
	else if (destroy === 'cut') await g.cutSelection();
	else if (destroy === 'type-over') await g.typeOverSelection('Z');
	else await g.pasteOverSelection();

	await assertParseConvergence(ctx, note);

	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

// A paragraph is the only kind eligible to merge on Backspace (mergeRole=prose); its
// predecessor must be able to receive it (prose / prose-absorber / container). Scanning
// for that pair keeps the merge detour a real merge on any note instead of a
// move-focus no-op that would trip the gesture's loud guard.
const MERGEABLE_PREV_KINDS = new Set([
	'paragraph',
	'heading',
	'setextHeading',
	'blockquote',
	'list'
]);

async function findMergeableParagraph(ctx: SimContext): Promise<number | null> {
	const count = await ctx.editor.bridge.getBlockCount();
	for (let t = 1; t < count; t++) {
		const [curr, prev] = await Promise.all([
			ctx.editor.bridge.getBlockKind(t),
			ctx.editor.bridge.getBlockKind(t - 1)
		]);
		if (curr === 'paragraph' && MERGEABLE_PREV_KINDS.has(prev)) return t;
	}
	return null;
}

/**
 * Merge a paragraph into its predecessor with a real Backspace at its start, then undo
 * — net identity. Backspace-at-offset-0 drives the merge-rules dispatch (para→para,
 * para→heading absorb, or para→container deepest leaf depending on the note's shape),
 * the subsystem the corruption oracle otherwise never fuzzes. The target is chosen at
 * runtime so the Backspace always merges; the closing undo proves it is byte-reversible.
 */
async function mergeUndoDetour(ctx: SimContext, g: Gestures, note: NoteFixture): Promise<void> {
	const target = await findMergeableParagraph(ctx);
	if (target === null) return;
	const before = await ctx.editor.bridge.getSource();
	await g.pause();
	await g.mergeBackspaceAtStart([target]);
	await assertParseConvergence(ctx, note);
	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

/**
 * The whole-session undo integrity oracle: unwind the entire authoring stack to its
 * floor and prove it lands byte-exact on the session's initial source, then rewind to
 * the top and prove it reconstructs the built note. The mid-session
 * `undoRedoDifferential` fences one gesture; this fences the whole stack the build
 * produced. Deterministic — it drives undo/redo by the stack depth read from the
 * bridge, no wall-clock waits. The redo stack must be empty on entry (the caller runs
 * this right after the build, before the net-identity detours perturb it).
 */
async function runFullSessionUndoUnwind(ctx: SimContext, initialSource: string): Promise<void> {
	const preUnwind = await ctx.editor.bridge.getSource();
	const depth = await undoStackDepth(ctx);
	if (depth === 0) {
		throw new Error(
			`[${ctx.label}] undo-unwind: the build produced an empty undo stack — the ` +
				`authoring gestures registered no undo entries.`
		);
	}

	for (let i = 0; i < depth; i++) {
		await ctx.editor.undo();
		await ctx.editor.waitForRenderFlush();
	}
	const floor = await ctx.editor.bridge.getSource();
	if (floor !== initialSource) {
		throw new Error(
			`[${ctx.label}] undo-unwind did not reach the initial source at the stack floor.\n` +
				`EXPECTED: ${JSON.stringify(initialSource)}\n` +
				`ACTUAL:   ${JSON.stringify(floor)}`
		);
	}

	for (let i = 0; i < depth; i++) {
		await ctx.editor.redo();
		await ctx.editor.waitForRenderFlush();
	}
	const top = await ctx.editor.bridge.getSource();
	if (top !== preUnwind) {
		throw new Error(
			`[${ctx.label}] undo-unwind rewind did not reconstruct the pre-unwind source.\n` +
				`EXPECTED: ${JSON.stringify(preUnwind)}\n` +
				`ACTUAL:   ${JSON.stringify(top)}`
		);
	}
	ctx.tracker.resync(top);
}

/** Undo-stack depth from the debug bridge dump — the recorder parses it the same way. */
async function undoStackDepth(ctx: SimContext): Promise<number> {
	const dump: string = await ctx.page.evaluate(() => (window as any).__test.dumpUndoStack());
	const match = /undo-depth=(\d+)/.exec(dump);
	if (!match) {
		throw new Error(`[${ctx.label}] undo-unwind: could not read undo depth from the bridge dump.`);
	}
	return Number(match[1]);
}

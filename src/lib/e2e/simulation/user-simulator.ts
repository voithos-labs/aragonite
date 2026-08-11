import type { Page } from '@playwright/test';
import type { EditorPage } from '../editor-page';
import { makeRng, type Rng } from './rng';
import { ExpectationTracker } from './expectation';
import { attachErrorCollector } from './error-collector';
import { Gestures } from './gestures';
import { Recorder, runDirForSeed } from './recorder';
import { availableRangeInterrupts } from './gestures/range-interrupt';
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
	undoRedoDifferential,
	undoStackDepth
} from './invariants';

export interface SessionOpts {
	seed: number;
	note: NoteFixture;
	capture?: boolean;
	/**
	 * Off by default: it drives one undo/redo per stack entry, so it is wired into the smoke
	 * note and a single multi-seed seed rather than every session.
	 */
	undoUnwind?: boolean;
}

const EMPTY_BASELINE = '\n';

/**
 * Drives one full note-taking session through real gestures, running the oracle suite
 * continuously. The end-state target is computed up front by LOADING the note's markdown
 * (typing ≡ loading), then the editor is cleared to author into. Never call `loadContent(x)`
 * when the prop already holds `x`: `setSource` is a no-op on an unchanged value, so each hop
 * of the start sequence must be a real value change.
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
		await assertParseConvergence(ctx);
		await assertContainsInOrder(ctx, opts.note.landmarks);
		await recorder?.checkpoint('note-built', 'build');

		// Placed HERE, not at note end, because it needs an empty redo stack: the detours below
		// each close with an undo whose redo residue would make "rewind to the top" ill-defined.
		if (opts.undoUnwind) {
			ctx.label = 'undo-unwind';
			await runFullSessionUndoUnwind(ctx, baseline);
		}

		ctx.label = 'jump-back-detour';
		await g.lateCorrection([0]);
		await recorder?.checkpoint('detour-done', 'jump-back');

		ctx.label = 'cancelling-detours';
		await runCancellingDetours(ctx, g, rng);

		ctx.label = 'undo-redo-differential';
		await runRevertingDifferential(ctx);

		ctx.label = 'end-state';
		await assertNoErrors(ctx);
		await assertContainerParity(ctx);
		await assertRoundTripStable(ctx);
		await assertSelectionValidity(ctx);
		await assertParseConvergence(ctx);
		await assertEndState(ctx, canonical);
	} finally {
		await recorder?.finalize();
	}
}

/**
 * Drops the edit afterward: the differential must not leave a residual char that would fail
 * the end-state equality oracle.
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
 * Seeded realism detours that each NET TO IDENTITY, so the end-state equality oracle still
 * holds for every note and seed. The seed gates which fire, spreading undo-batch shapes across
 * runs. The `pause()`s are load-bearing, not decoration: each flushes the input batcher so the
 * following delete lands in its own undo entry, without which one Ctrl+Z overshoots.
 */
async function runCancellingDetours(ctx: SimContext, g: Gestures, rng: Rng): Promise<void> {
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
	// multi-seed runner spreads every mode across seeds — the flip must not perturb the
	// clean built source under any live gesture state.
	if (rng.chance(0.7)) {
		await g.flipPresentationMode(
			rng.pick(['reading', 'preview-block', 'preview-inline', 'live'] as const)
		);
	}

	// The two most dangerous surfaces, appended so the existing seed→detour mapping is
	// preserved. Both net to identity via a trailing undo, so end-state equality holds.
	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.6)) {
		await crossBlockDestroyUndoDetour(ctx, g, rng);
	}

	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.6)) {
		await mergeUndoDetour(ctx, g);
	}

	// Appended last for the same reason as the pair above: every draw before it keeps
	// its existing seed→detour mapping.
	if (rng.chance(0.7)) {
		await rangeInterruptDetour(ctx, g, rng);
	}
}

/**
 * The precondition behind two whole-document losses. The seed picks which gesture fires from
 * the set THIS document can reach, so seeds spread across the interrupt surface.
 */
async function rangeInterruptDetour(ctx: SimContext, g: Gestures, rng: Rng): Promise<void> {
	const available = await availableRangeInterrupts(ctx);
	if (available.length === 0) return;
	await g.rangeInterrupt(rng.pick(available));
}

/**
 * Drives a reorder BETWEEN edits and undo/redo — the interleaving that surfaces the
 * aliasing/unshare/stamp corruption a reorder can introduce, which the simulation is the only
 * oracle for (`docs/contributing/culture.md` § Testing shape). Block 0 is a heading or
 * paragraph with a sibling below it in every note, so the move is never a no-op.
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
 * Block 0 is a heading or paragraph in every note, so `End` plus a small leftward selection
 * always has chars to remove. The pre-delete `pause` fences the delete into its own undo
 * batch, so one Ctrl+Z reverses exactly it.
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
 * Net identity, fenced with `pause` like the delete detour. The clipboard is left dirty, but
 * the source is unchanged once the paste is undone — all the end-state oracle observes.
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
 * Cross-block destruction is the surface that held the historical corruption Criticals, so
 * driving it here puts a range collapse + merge under the full oracle sweep on every seed.
 * The seed picks both the build and the destroy, spreading across the entry×exit matrix.
 */
async function crossBlockDestroyUndoDetour(ctx: SimContext, g: Gestures, rng: Rng): Promise<void> {
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

	await assertParseConvergence(ctx);

	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

// Scanning for an eligible pair keeps the detour a REAL merge on any note, instead of a
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
 * Backspace-at-offset-0 drives the merge-rules dispatch, the subsystem the corruption oracle
 * otherwise never fuzzes. The target is chosen at RUNTIME so the Backspace always merges.
 */
async function mergeUndoDetour(ctx: SimContext, g: Gestures): Promise<void> {
	const target = await findMergeableParagraph(ctx);
	if (target === null) return;
	const before = await ctx.editor.bridge.getSource();
	await g.pause();
	await g.mergeBackspaceAtStart([target]);
	await assertParseConvergence(ctx);
	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

/**
 * Unwinds the whole authoring stack to its floor and rewinds it, where `undoRedoDifferential`
 * fences a single gesture. Deterministic: driven by the stack depth read from the bridge, not
 * wall-clock waits. The redo stack must be EMPTY on entry, so the caller runs this right after
 * the build, before the net-identity detours perturb it.
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

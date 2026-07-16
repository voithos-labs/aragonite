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
	assertEndState,
	assertNestedStateConsistent,
	assertNoErrors,
	assertRoundTripStable,
	undoRedoDifferential
} from './invariants';

export interface SessionOpts {
	seed: number;
	note: NoteFixture;
	capture?: boolean;
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
		await assertRoundTripStable(ctx);
		await assertContainsInOrder(ctx, opts.note.landmarks);
		await recorder?.checkpoint('note-built', 'build');

		ctx.label = 'jump-back-detour';
		await g.lateCorrection([0]);
		await recorder?.checkpoint('detour-done', 'jump-back');

		ctx.label = 'cancelling-detours';
		await runCancellingDetours(ctx, g, rng);

		ctx.label = 'undo-redo-differential';
		await runRevertingDifferential(ctx);

		ctx.label = 'end-state';
		await assertNoErrors(ctx);
		await assertRoundTripStable(ctx);
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
	// multi-seed runner spreads reading / preview-block / preview-inline across seeds —
	// the flip must not perturb the clean built source under any live gesture state.
	if (rng.chance(0.7)) {
		await g.flipPresentationMode(rng.pick(['reading', 'preview-block', 'preview-inline'] as const));
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

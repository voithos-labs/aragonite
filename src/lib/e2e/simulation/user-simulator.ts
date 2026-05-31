import type { Page } from '@playwright/test';
import type { EditorPage } from '../editor-page';
import { makeRng } from './rng';
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

	// The post-build oracles can throw on a known, deferred desync the headline
	// note reaches (docs/issues.md: list-exit innerBlockRefs) — finalize in a
	// finally so the mid-build capture manifest still lands for the visual review,
	// then re-throw so the oracle failure is never masked.
	try {
		ctx.label = 'checkpoint';
		await assertNoErrors(ctx);
		await assertNestedStateConsistent(ctx);
		await assertRoundTripStable(ctx);
		await assertContainsInOrder(ctx, opts.note.landmarks);
		await recorder?.checkpoint('note-built', 'build');

		ctx.label = 'jump-back-detour';
		await runJumpBackDetour(ctx, g);
		await recorder?.checkpoint('detour-done', 'jump-back');

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
 * Click back into the first top-level block (CRITICAL-2: clickToReposition asserts
 * the focus block path), make a cancelling edit there — one char typed then removed
 * — and confirm net-identity before continuing, so the end-state equality oracle
 * still holds. The edit is resync-based, not tracker-predicted: the tracker's
 * append rule inserts at end-of-content, but this caret is mid-document, so a raw
 * keystroke plus a source-delta settle is the only sound observation here.
 */
async function runJumpBackDetour(ctx: SimContext, g: Gestures): Promise<void> {
	const clean = await ctx.editor.bridge.getSource();
	await g.clickToReposition([0], 0);
	await ctx.editor.typeSlowly('z');
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, clean);
	await ctx.editor.page.keyboard.press('Backspace');
	await ctx.editor.bridge.waitForSourceEquals(clean);
	ctx.tracker.resync(clean);
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
		await ctx.editor.bridge.waitForSourceContains('X', 2000);
	});
	await ctx.editor.undo();
	await ctx.editor.bridge.waitForSourceEquals(clean, 3000);
	ctx.tracker.resync(clean);
}

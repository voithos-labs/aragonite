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
	assertCheckpoint,
	assertContainsInOrder,
	assertEndState,
	assertParseConvergence,
	revertingDetour,
	undoRedoDifferential
} from './invariants';

export interface SessionOpts {
	seed: number;
	note: NoteFixture;
	capture?: boolean;
	/**
	 * Off by default: it drives one undo and redo per stack entry, so only the smoke note and a
	 * single multi-seed run turn it on.
	 */
	undoUnwind?: boolean;
}

const EMPTY_BASELINE = '\n';

/**
 * Drives one full note-taking session through real gestures, running the checks all the way
 * through. The target for the end state is worked out first by loading the note's markdown
 * (typing has to match loading), then the editor is cleared to type into. Never call
 * `loadContent(x)` when the editor already holds `x`: `setSource` does nothing on an unchanged
 * value, so each step of the start sequence has to be a real change.
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
			`Calibration failure: empty baseline is ${JSON.stringify(baseline)}, ` +
				`expected ${JSON.stringify(EMPTY_BASELINE)}. The tracker insert rule and the ` +
				`baseline assumption both depend on this, so stop and recalibrate.`
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

	// The capture manifest is written in a `finally`, so that if a check throws mid-session the
	// screenshots and state dumps gathered so far are still there for the visual review; the
	// failure then throws on, never hidden.
	try {
		await assertCheckpoint(ctx, 'checkpoint');
		await assertContainsInOrder(ctx, opts.note.landmarks);
		await recorder?.checkpoint('note-built', 'build');

		// Here rather than at the end of the note, because it needs an empty redo stack: each
		// detour below ends in an undo, and what it leaves on the redo stack would make
		// "rewind to the top" mean nothing definite.
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

		await assertCheckpoint(ctx, 'end-state');
		await assertEndState(ctx, canonical);
	} finally {
		await recorder?.finalize();
	}
}

/**
 * Drops the edit afterwards: this must not leave a stray character behind, which would fail the
 * check that the end state matches.
 */
async function runRevertingDifferential(ctx: SimContext): Promise<void> {
	const clean = await ctx.editor.bridge.getSource();
	await undoRedoDifferential(ctx, async () => {
		await ctx.editor.typeSlowly('X');
		// Confirm the keystroke arrived by watching the source change, not by matching content:
		// `waitForSourceContains('X')` would pass on any note whose source already holds an 'X'.
		await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, clean, 2000);
	});
	await ctx.editor.undo();
	await ctx.editor.bridge.waitForSourceEquals(clean, 3000);
	ctx.tracker.resync(clean);
}

/**
 * Detours that make the session look human and each leave the bytes exactly as they were, so the
 * end state still matches for every note and seed. The seed decides which run, and the pauses
 * between them spread the shapes of undo batches across runs.
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

	// The bytes must survive a presentation-mode switch. The seed picks which mode, so the
	// multi-seed runner covers them all: no mode switch may disturb the built source.
	if (rng.chance(0.7)) {
		await g.flipPresentationMode(
			rng.pick(['reading', 'preview-block', 'preview-inline', 'live'] as const)
		);
	}

	// The two riskiest gestures, added at the end so each seed still picks the same detours as
	// before. Both leave the bytes as they were, thanks to a closing undo.
	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.6)) {
		await crossBlockDestroyUndoDetour(ctx, g, rng);
	}

	if (rng.chance(0.5)) await g.pause();

	if (rng.chance(0.6)) {
		await mergeUndoDetour(ctx, g);
	}

	// Added last for the same reason as the pair above: every draw before it keeps the detour
	// its seed picked before.
	if (rng.chance(0.7)) {
		await rangeInterruptDetour(ctx, g, rng);
	}
}

/**
 * A live cross-block range interrupted by another gesture, the situation behind two whole
 * documents being lost. The seed picks from the gestures this document can reach, so the seeds
 * spread across them.
 */
async function rangeInterruptDetour(ctx: SimContext, g: Gestures, rng: Rng): Promise<void> {
	const available = await availableRangeInterrupts(ctx);
	if (available.length === 0) return;
	await g.rangeInterrupt(rng.pick(available));
}

/**
 * Moves a block between edits and undo, the order of events that brings out the shared-node
 * corruption a reorder can cause and that only the simulation catches
 * (`docs/contributing/rules.md` § Testing shape). Block 0 is a heading or paragraph with a
 * sibling below it in every note, so the move always does something.
 */
async function reorderUndoDetour(ctx: SimContext, g: Gestures): Promise<void> {
	await revertingDetour(ctx, () => g.reorder(0, 1));
}

/**
 * Block 0 is a heading or paragraph in every note, so `End` plus a small selection to the left
 * always has characters to remove.
 */
async function selectDeleteUndoDetour(ctx: SimContext, g: Gestures, rng: Rng): Promise<void> {
	await revertingDetour(ctx, async () => {
		await g.clickToReposition([0]);
		await ctx.page.keyboard.press('End');
		await g.selectAndDelete(rng.int(3, 6));
	});
}

/**
 * The clipboard is left holding text, but the source is unchanged once the paste is undone,
 * which is all the end state looks at.
 */
async function copyPasteUndoDetour(ctx: SimContext, g: Gestures): Promise<void> {
	await revertingDetour(ctx, async () => {
		await g.clickToReposition([0]);
		await ctx.page.keyboard.press('End');
		await g.selectChars(4);
		await g.copySelection();
		await ctx.page.keyboard.press('End');
		await g.pasteHere();
	});
}

/**
 * Deleting across blocks is where the worst corruption bugs came from, so driving it here puts
 * a range collapse and merge under the full set of checks on every seed. The seed picks both how
 * the range is built and how it is destroyed, so the pairs spread across runs.
 */
async function crossBlockDestroyUndoDetour(ctx: SimContext, g: Gestures, rng: Rng): Promise<void> {
	const destroy = rng.pick(['backspace', 'delete', 'cut', 'type-over', 'paste-over'] as const);
	await revertingDetour(ctx, () => buildAndDestroyRange(ctx, g, rng, destroy));
}

async function buildAndDestroyRange(
	ctx: SimContext,
	g: Gestures,
	rng: Rng,
	destroy: 'backspace' | 'delete' | 'cut' | 'type-over' | 'paste-over'
): Promise<void> {
	// Pasting over the range needs something on the clipboard, so copy from block 0 first: the
	// copy collapses whatever is selected, so it has to happen before the range is built.
	if (destroy === 'paste-over') {
		await g.clickToReposition([0]);
		await ctx.page.keyboard.press('End');
		await g.selectChars(3);
		await g.copySelection();
	}

	await g.clickToReposition([0]);
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
}

// Looking for an eligible pair keeps the detour a real merge on any note, rather than a
// move-the-caret no-op that would trip the gesture's loud check.
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
 * Backspace at offset 0 runs the merge rules, which nothing else here exercises at random. The
 * target block is chosen while the session runs, so the Backspace always merges.
 */
async function mergeUndoDetour(ctx: SimContext, g: Gestures): Promise<void> {
	const target = await findMergeableParagraph(ctx);
	if (target === null) return;
	await revertingDetour(ctx, async () => {
		await g.mergeBackspaceAtStart([target]);
		await assertParseConvergence(ctx);
	});
}

/**
 * Undoes the whole session to the bottom of the stack and redoes it, where
 * `undoRedoDifferential` covers a single gesture. Driven by the stack depth read from the
 * editor, not by waiting on the clock. The redo stack has to be empty on entry, so the caller
 * runs this right after the build, before the detours disturb it.
 */
async function runFullSessionUndoUnwind(ctx: SimContext, initialSource: string): Promise<void> {
	const preUnwind = await ctx.editor.bridge.getSource();
	const depth = await ctx.editor.bridge.getUndoDepth();
	if (depth === 0) {
		throw new Error(
			`[${ctx.label}] undo-unwind: the build produced an empty undo stack; the ` +
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

import type { Page } from '@playwright/test';
import type { EditorPage } from '../editor-page';
import { makeRng, type Rng } from './rng';
import { ExpectationTracker } from './expectation';
import { attachErrorCollector } from './error-collector';
import { Gestures } from './gestures';
import { Recorder, runDirForSeed } from './recorder';
import { availableRangeInterrupts } from './gestures/range-interrupt';
import { planDetours, type RangeBuild, type RangeDestroy, type SessionDraws } from './detour-plan';
import { SESSION_TYPO_RATE } from './typos';
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
	 * Off by default, since it drives one undo and redo per stack entry.
	 */
	undoUnwind?: boolean;
}

const EMPTY_BASELINE = '\n';

/**
 * Loads the note's markdown first to get the end-state target (typing must match loading), then
 * clears the editor. `setSource` ignores an unchanged value, so each start step must be a change.
 */
export async function runSession(
	page: Page,
	editor: EditorPage,
	opts: SessionOpts
): Promise<SessionDraws> {
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
		typoRate: SESSION_TYPO_RATE,
		onCheckpoint: recorder ? (label, gesture) => recorder.checkpoint(label, gesture) : undefined
	});

	ctx.label = 'build';
	await opts.note.build(g);

	// Written in a `finally`, so a check that throws mid-session still leaves its screenshots and
	// dumps for the visual review, then throws on.
	try {
		await assertCheckpoint(ctx, 'checkpoint');
		await assertContainsInOrder(ctx, opts.note.landmarks);
		await recorder?.checkpoint('note-built', 'build');

		// Runs before the detours, which each end in an undo, because it needs an empty redo stack.
		if (opts.undoUnwind) {
			ctx.label = 'undo-unwind';
			await runFullSessionUndoUnwind(ctx, baseline);
		}

		ctx.label = 'jump-back-detour';
		await g.lateCorrection([0]);
		await recorder?.checkpoint('detour-done', 'jump-back');

		ctx.label = 'cancelling-detours';
		const draws = await runCancellingDetours(ctx, g, rng);

		ctx.label = 'undo-redo-differential';
		await runRevertingDifferential(ctx);

		await assertCheckpoint(ctx, 'end-state');
		await assertEndState(ctx, canonical);
		return draws;
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
 * Detours that make the session look human, each leaving the bytes as they were. The seed picks
 * which run (`detour-plan.ts`).
 */
async function runCancellingDetours(ctx: SimContext, g: Gestures, rng: Rng): Promise<SessionDraws> {
	const draws: SessionDraws = { plan: planDetours(rng), interrupts: null, interrupt: null };
	for (const step of draws.plan) {
		if (step.kind === 'pause') await g.pause();
		else if (step.kind === 'select-delete') await selectDeleteUndoDetour(ctx, g, step.chars);
		else if (step.kind === 'copy-paste') await copyPasteUndoDetour(ctx, g);
		else if (step.kind === 'reorder') await reorderUndoDetour(ctx, g);
		else if (step.kind === 'mode-flip') await g.flipPresentationMode(step.mode);
		else if (step.kind === 'cross-block') await crossBlockDestroyUndoDetour(ctx, g, step);
		else if (step.kind === 'merge') await mergeUndoDetour(ctx, g);
		else await rangeInterruptDetour(ctx, g, rng, draws);
	}

	// Runs on every seed and draws nothing, so the picks above stay what each seed made them.
	await nestedKindChangeUndoDetour(ctx, g);
	return draws;
}

/**
 * A kind change typed inside a list item undoes with the key before it, as at the top level.
 * It takes the first top-level list whose first item is plain (no task, a paragraph first).
 */
async function nestedKindChangeUndoDetour(ctx: SimContext, g: Gestures): Promise<void> {
	const path = await ctx.page.evaluate(() => {
		const children = (window as any).__test.getDocument().children as any[];
		for (let i = 0; i < children.length; i++) {
			if (children[i].kind !== 'list') continue;
			const item = children[i].children?.[0];
			if (!item?.metadata?.taskItem && item?.children?.[0]?.kind === 'paragraph') return [i, 0, 0];
		}
		return null;
	});
	if (path === null) return;
	await g.kindChangeUndoInListItem(path);
}

/**
 * The seed picks from the interrupting gestures this document can reach.
 */
async function rangeInterruptDetour(
	ctx: SimContext,
	g: Gestures,
	rng: Rng,
	draws: SessionDraws
): Promise<void> {
	draws.interrupts = await availableRangeInterrupts(ctx);
	if (draws.interrupts.length === 0) return;
	draws.interrupt = rng.pick(draws.interrupts);
	await g.rangeInterrupt(draws.interrupt);
}

/**
 * Moving a block between edits and undo brings out the shared-node corruption a reorder can
 * cause (`docs/contributing/rules.md` § Testing shape). Every note's block 0 has a sibling below.
 */
async function reorderUndoDetour(ctx: SimContext, g: Gestures): Promise<void> {
	await revertingDetour(ctx, () => g.reorder(0, 1));
}

/**
 * Block 0 is a heading or paragraph in every note, so `End` plus a small selection to the left
 * always has characters to remove.
 */
async function selectDeleteUndoDetour(ctx: SimContext, g: Gestures, chars: number): Promise<void> {
	await revertingDetour(ctx, async () => {
		await g.clickToReposition([0]);
		await ctx.page.keyboard.press('End');
		await g.selectAndDelete(chars);
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
 * Puts a range collapse and merge under the full checks on every seed; the seed picks how the
 * range is built and how it is destroyed.
 */
async function crossBlockDestroyUndoDetour(
	ctx: SimContext,
	g: Gestures,
	pick: { destroy: RangeDestroy; build: RangeBuild }
): Promise<void> {
	await revertingDetour(ctx, () => buildAndDestroyRange(ctx, g, pick.destroy, pick.build));
}

async function buildAndDestroyRange(
	ctx: SimContext,
	g: Gestures,
	destroy: RangeDestroy,
	build: RangeBuild
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
 * Undoes the whole session and redoes it, where `undoRedoDifferential` covers one gesture. The
 * redo stack must be empty on entry, so the caller runs this right after the build.
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

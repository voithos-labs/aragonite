/**
 * The one replace every destructive gesture over a live range goes through: Backspace, Delete, cut,
 * typing, an IME composition, paste, and a command key such as Enter. It removes what the range
 * covers, puts the insertion where the removal left the caret (a line of text inside one cell is
 * one write instead) and lands one caret, all as one undo entry. The rules by gesture and coverage
 * are `docs/design/selection.md` § Cross-block selection.
 */

import type { AnyBlockKind, CstNode, Document } from '../../core/nodes';
import { documentLineEnding } from '../../core/lines';
import { CURSOR_END } from '../../block-component';
import type { HeldLanding } from '../../action-contracts';
import type { CrossBlockDispatchContext } from './dispatch';
import { charOffsetOf, deleteSnapshot, type SelectionPoint } from '../primitives';
import { coverRange, rangeCoverage, type RangeCoverage } from '../range-coverage';
import type { RemovalGesture } from '../caret-target';
import type { RemovalGesture as CoreGesture } from '../../range-edit/edit-range';
import { pathsEqual } from '../path-math';
import { blockNodeAt, isBlockNode } from '../../tree-operations/node-primitives';
import { commitGridClear, commitGridLineDelete } from './grid-removal';
import {
	CORE_GESTURE,
	commandLandingKind,
	emptiedPlace,
	removeThroughCore,
	writeInCell,
	type Removed
} from './range-removal';
import { pasteDispatch } from '../../tree-operations/paste/dispatch';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import { parseReplacement } from '../../tree-operations/paste/replacement-parse';
import { slotReaderAt } from '../../tree-operations/list/task-paragraph';
import { dispatchKeyCommand } from '../../schema/block-commands';
import { blockFacts } from '../../schema/block-facts';
import { emitClipboardError } from '../../editor-events';
import { assertInvariant, devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { checkCommandLanding } from '../../invariants/command-key-landing';

// ── Public API ─────────────────────────────────────────────────────────────

/** What a gesture puts where the range was; `none` names the gesture, which picks the side a
 *  caret takes when a block goes whole. */
export type RangeInsertion =
	| { kind: 'none'; gesture: RemovalGesture }
	| { kind: 'text'; text: string }
	| { kind: 'paste'; text: string }
	| { kind: 'composition' }
	| { kind: 'command'; chord: string };

/** `refused`: reading mode, a document a `source` swap replaced, or a paragraph that couldn't open. */
export type RangeReplaceOutcome = 'written' | 'nothing' | 'refused';

export type CrossBlockMutationContext = Pick<
	CrossBlockDispatchContext,
	| 'selection'
	| 'getDoc'
	| 'controller'
	| 'reading'
	| 'caretLanding'
	| 'caretMemory'
	| 'events'
	| 'blockEdit'
	| 'pasteCoordinator'
	| 'activePlugins'
	| 'commands'
	| 'bytes'
>;

/**
 * Removes what the live range covers and puts `insertion` where that leaves the caret. Every await
 * is a tick, so a composition's removal and its caret both land before the IME writes.
 */
export async function replaceRange(
	ctx: CrossBlockMutationContext,
	insertion: RangeInsertion
): Promise<RangeReplaceOutcome> {
	const { anchor, focus, start } = ctx.selection;
	if (!ctx.selection.ownsRange || !anchor || !focus || !start) return 'nothing';
	if (!ctx.controller.admitsGesture(refusalName(insertion))) return 'refused';
	ctx.caretMemory.forget();
	ctx.selection.resetSelectAllCount();
	if (insertion.kind === 'paste' && !insertion.text) return 'nothing';

	const doc = ctx.getDoc();
	const coverage = rangeCoverage(doc, coverRange(doc, anchor, focus));
	// Widened, since the step assigns it inside a callback the compiler can't follow.
	let outcome = 'nothing' as RangeReplaceOutcome;
	// Seeded with the range, so one Ctrl+Z puts it back as it stood.
	await ctx.controller.undoStep(deleteSnapshot(start.path, start.offset), async () => {
		outcome = await replaceInStep(ctx, coverage, insertion);
	});
	// After the step, whose end starts a new typing batch: the composed text joins the removal.
	if (insertion.kind === 'composition' && outcome === 'written') {
		ctx.controller.continueTypingBurst();
	}
	return outcome;
}

/** The kind of the deepest block `path` resolves to; the document root reads as its own kind. */
export function kindOfPath(path: number[], doc: Document): AnyBlockKind {
	let node: CstNode | Document = doc;
	for (const i of path) {
		const child: CstNode | undefined = node.children?.[i];
		if (!child) break;
		node = child;
	}
	return isBlockNode(node) ? node.kind : (node.kind as AnyBlockKind);
}

// ── The step ───────────────────────────────────────────────────────────────

/** Every commit's caret is held, so the replace puts down one: the last commit's that wrote, else
 *  the removal's. A command key is Backspace and then the key, so its block lands its own too. */
async function replaceInStep(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	insertion: RangeInsertion
): Promise<RangeReplaceOutcome> {
	const family = familyOf(insertion);
	const removal = REMOVAL[family][reachOf(coverage)];
	if (removal === 'replace-in-slot') {
		const [outcome, landing] = await ctx.controller.holdLandings(() =>
			replaceUnit(ctx, coverage.wholeRoots[0].slice(), insertion)
		);
		await landing?.place();
		return outcome;
	}
	const inCell = family === 'content' ? await replaceInCell(ctx, coverage, insertion) : null;
	if (inCell !== null) return inCell;

	const claimed =
		insertion.kind === 'command' && devChecksOn ? commandLandingKind(ctx.getDoc(), coverage) : null;
	const [removed, held] = await ctx.controller.holdLandings(() =>
		removeRange(ctx, coverage, removal, insertion)
	);
	if (!removed.wrote && !removed.caret) return 'nothing';
	const removalCaret = held ?? (removed.wrote ? null : caretAt(ctx, removed.caret!));
	const place = family !== 'structural' ? emptiedPlace(ctx.getDoc(), removed) : null;
	if (place) return insertInEmptiedPlace(ctx, coverage, insertion, place, removalCaret);

	const at = removed.caret;
	if (insertion.kind === 'command') {
		// Before the command runs, since the block reads the caret to run it.
		await removalCaret?.place();
		const path = at?.path ?? coverage.range.start.path;
		if (claimed) {
			assertInvariant('command-key-landing', () =>
				checkCommandLanding(claimed, kindOfPath(path, ctx.getDoc()))
			);
		}
		await runCommandAt(ctx, path, insertion.chord);
		return 'written';
	}
	if (insertion.kind === 'none') {
		await removalCaret?.place();
		return 'written';
	}
	return insertAtCaret(ctx, coverage, insertion, at, removalCaret);
}

/** The caret a removal that took nothing leaves at the range's start, ending the range when placed. */
function caretAt(ctx: CrossBlockMutationContext, point: SelectionPoint): HeldLanding {
	return {
		async place() {
			ctx.selection.collapse();
			await ctx.caretLanding.restore({ anchor: point, focus: point });
		}
	};
}

/** The insertion at `at`, where the removal, or the paragraph opened after it, left the caret. */
async function insertAtCaret(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	insertion: RangeInsertion,
	at: SelectionPoint | null,
	caretLanding: HeldLanding | null
): Promise<RangeReplaceOutcome> {
	const typed =
		insertion.kind === 'text' && at
			? await typedByBlock(ctx, at, insertion.text, caretLanding)
			: null;
	if (typed) return typed;
	const text = insertion.kind === 'text' || insertion.kind === 'paste' ? insertion.text : '';
	const [, insertionLanding] = await ctx.controller.holdLandings(() =>
		insertAt(ctx, at, insertion, text)
	);
	await (insertionLanding ?? caretLanding)?.place();
	if (text && !at && insertion.kind === 'paste') {
		// Consumed with nowhere to go: an imported image isn't on the clipboard, so say so.
		emitClipboardError(ctx.events, {
			error: new Error('cross-block paste resolved no caret; nothing inserted'),
			path: coverage.range.start.path.slice()
		});
	}
	return 'written';
}

/** The insertion in an empty paragraph opened where the range was, at `place`. A paragraph that
 *  can't open drops the text, since the removal's caret sits on a block's syntax. */
async function insertInEmptiedPlace(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	insertion: RangeInsertion,
	place: number[],
	removalCaret: HeldLanding | null
): Promise<RangeReplaceOutcome> {
	const [opened, landing] = await ctx.controller.holdLandings(() =>
		ctx.pasteCoordinator.insertParagraph(place, '')
	);
	if (opened) return insertAtCaret(ctx, coverage, insertion, { path: place, offset: 0 }, landing);
	devWarn('range-replace', 'no paragraph opened where the range was, so the text was dropped', {
		place
	});
	await removalCaret?.place();
	return 'refused';
}

/** Keyed gestures name themselves in reading mode's dev warning; a cut or a paste is refused
 *  quietly, as the clipboard refuses reading mode. */
function refusalName(insertion: RangeInsertion): string | null {
	if (insertion.kind === 'paste') return null;
	if (insertion.kind === 'none') return insertion.gesture === 'cut' ? null : 'rangeDelete';
	return `rangeReplace:${insertion.kind}`;
}

// ── The removal, picked by insertion family and coverage ───────────────────

/** Structural gestures remove what Backspace removes, content ones put text where the range was,
 *  and a composition only clears, since its text arrives from the IME after the caret lands. */
type Family = 'structural' | 'content' | 'composition';

/** What the range holds: one block whole (a table, a rule), whole rows or columns of one table,
 *  a rectangle of its cells, or anything else. */
type Reach = 'unit' | 'lines' | 'cells' | 'other';

/** Removes what the range covers and keeps what it can, takes the blocks it holds whole out, or
 *  takes a table's whole rows or columns. */
type RangeRemoval = 'delete' | 'remove-whole' | 'remove-lines';

type Removal = 'replace-in-slot' | RangeRemoval;

const STRUCTURAL_REMOVAL: Record<Reach, RangeRemoval> = {
	unit: 'remove-whole',
	lines: 'remove-lines',
	cells: 'delete',
	other: 'delete'
};

const REMOVAL: Record<Family, Record<Reach, Removal>> = {
	structural: STRUCTURAL_REMOVAL,
	content: { unit: 'replace-in-slot', lines: 'delete', cells: 'delete', other: 'delete' },
	composition: { unit: 'delete', lines: 'delete', cells: 'delete', other: 'delete' }
};

/** Typing nothing is a keyless delete. */
function familyOf(insertion: RangeInsertion): Family {
	switch (insertion.kind) {
		case 'none':
		case 'command':
			return 'structural';
		case 'text':
		case 'paste':
			return insertion.text ? 'content' : 'structural';
		case 'composition':
			return 'composition';
	}
}

function reachOf(coverage: RangeCoverage): Reach {
	const { start, end } = coverage.range;
	if (pathsEqual(start.path, end.path) && coverage.wholeRoots.length === 1) return 'unit';
	if (coverage.grid?.kind === 'row' || coverage.grid?.kind === 'column') return 'lines';
	return coverage.grid ? 'cells' : 'other';
}

/** The removal a gesture over the range makes: a table's cells by the grid, all else by the
 *  range-edit core. */
function removeRange(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	removal: Exclude<Removal, 'replace-in-slot'>,
	insertion: RangeInsertion
): Promise<Removed> {
	const grid = coverage.grid;
	if (grid && removal === 'remove-lines' && (grid.kind === 'row' || grid.kind === 'column'))
		return commitGridLineDelete(ctx, grid).then(inCell);
	if (grid && removal !== 'remove-whole') return commitGridClear(ctx, coverage, grid).then(inCell);
	return removeThroughCore(ctx, coverage, coreGestureOf(insertion));
}

const inCell = (caret: SelectionPoint | null): Removed => ({
	wrote: caret !== null,
	caret,
	landed: null,
	took: null
});

/** How the core names the removal a gesture makes: typed or pasted text removes as a cut does, a
 *  composition as Delete does, a command key and a delete no key asked for as Backspace does. */
function coreGestureOf(insertion: RangeInsertion): CoreGesture {
	switch (insertion.kind) {
		case 'none':
			return CORE_GESTURE[insertion.gesture];
		case 'text':
		case 'paste':
			return insertion.text ? 'type' : 'command';
		case 'composition':
			return 'compose';
		case 'command':
			return 'command';
	}
}

// ── The insertion ──────────────────────────────────────────────────────────

/** The text parsed in the unit's slot, read as a reload reads it there, so a marker typed or
 *  pasted over the unit makes its kind. */
async function replaceUnit(
	ctx: CrossBlockMutationContext,
	unitPath: number[],
	insertion: RangeInsertion
): Promise<RangeReplaceOutcome> {
	const doc = ctx.getDoc();
	const unit = blockNodeAt(doc, unitPath);
	if (!unit || (insertion.kind !== 'text' && insertion.kind !== 'paste')) return 'nothing';
	// This route skips `pasteDispatch`, so a paste runs the editor's transforms here.
	const bytes =
		insertion.kind === 'paste'
			? applyPasteTransforms(insertion.text, ctx.activePlugins)
			: insertion.text;
	const read = slotReaderAt(doc, unitPath, ctx.reading.grammar);
	const parsed = parseReplacement(unit, bytes, documentLineEnding(doc), read);
	if (!parsed) return 'nothing';
	ctx.selection.collapse();
	const landed = await ctx.pasteCoordinator.replaceBlock(
		unitPath,
		parsed.replacement,
		{ replacementIndex: parsed.replacement.length - 1, offset: CURSOR_END },
		// A clipboard's trailing blank line comes in as is, since nothing follows the text; the
		// undo step records the range, so the offset is never read.
		{ source: 'cross-block-covered-block', trailingBlank: parsed.suffix !== '', snapshotOffset: 0 }
	);
	return landed === null ? 'nothing' : 'written';
}

/** Text over a range inside one table cell, as one write of the cell, the way a mouse's range there
 *  takes it: removed first, the cell would drop the space the removal leaves. Null elsewhere. */
async function replaceInCell(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	insertion: RangeInsertion
): Promise<RangeReplaceOutcome | null> {
	if (insertion.kind !== 'text' && insertion.kind !== 'paste') return null;
	const { start, end } = coverage.range;
	const row = blockNodeAt(ctx.getDoc(), start.path.slice(0, -1));
	if (!row || !pathsEqual(start.path, end.path) || blockFacts(row.kind).lines !== 'cells')
		return null;
	// This route skips `pasteDispatch`, so a paste runs the editor's transforms here.
	const text =
		insertion.kind === 'paste'
			? applyPasteTransforms(insertion.text, ctx.activePlugins)
			: insertion.text;
	const [wrote, landing] = await ctx.controller.holdLandings(() =>
		writeInCell(ctx, coverage, text)
	);
	if (wrote === null) return null;
	await landing?.place();
	return wrote ? 'written' : 'refused';
}

/** A character typed over a range is the range's removal, then the write the block makes for a
 *  character typed at its caret (`BlockComponent.typeText`); null where the block has none. */
async function typedByBlock(
	ctx: CrossBlockMutationContext,
	caret: SelectionPoint,
	text: string,
	removalCaret: HeldLanding | null
): Promise<RangeReplaceOutcome | null> {
	const block = await ctx.caretLanding.mount(caret.path);
	const typeText = block?.typeText;
	if (!typeText) return null;
	// Placed first, so the typed write's own caret lands from where the removal left it.
	await removalCaret?.place();
	const offset = charOffsetOf(caret, 'range-replace:type');
	const [wrote, landing] = await ctx.controller.holdLandings(() => typeText(text, offset));
	await landing?.place();
	// A document swapped in between the removal and the typed write refuses the write.
	return wrote ? 'written' : 'refused';
}

/** A paste goes through the paste dispatch, and text into a block with no typing write of its own
 *  through the reparsing commit, so a marker at offset 0 still makes the kind. */
async function insertAt(
	ctx: CrossBlockMutationContext,
	caret: SelectionPoint | null,
	insertion: RangeInsertion,
	text: string
): Promise<void> {
	const leaf = caret && blockNodeAt(ctx.getDoc(), caret.path);
	if (!text || !caret || !leaf) return;
	if (insertion.kind === 'paste') {
		await pasteDispatch(
			{
				pastedText: text,
				targetPath: caret.path,
				offset: charOffsetOf(caret, 'range-replace:paste')
			},
			{
				doc: ctx.getDoc(),
				blockEdit: ctx.blockEdit,
				controller: ctx.pasteCoordinator,
				crossBlock: true,
				reading: ctx.reading,
				activePlugins: ctx.activePlugins
			}
		);
		return;
	}
	const at = charOffsetOf(caret, 'range-replace:type');
	await ctx.pasteCoordinator.commitLeafText(
		caret.path,
		leaf.raw.slice(0, at) + text + leaf.raw.slice(at),
		{
			caret: at + text.length,
			snapshotOffset: caret.offset,
			landing: (landed) => landed.caret
		}
	);
}

/** At the caret the removal left, never over stale block indices: a table's endpoint caret is a
 *  cell, which has a `runCommand` where the table has none. */
async function runCommandAt(
	ctx: CrossBlockMutationContext,
	path: number[],
	chord: string
): Promise<void> {
	const target = await ctx.caretLanding.mount(path);
	if (!target) return;
	dispatchKeyCommand(
		chord,
		{
			kind: kindOfPath(path, ctx.getDoc()),
			runCommand: target.runCommand,
			getCommandContext: target.getCommandContext,
			getPath: () => path,
			afterSourceCommit: target.afterSourceCommit
		},
		ctx.commands,
		{ afterRemoval: true }
	);
}

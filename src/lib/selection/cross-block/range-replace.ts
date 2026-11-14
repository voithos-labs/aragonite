/**
 * The one replace every destructive gesture over a live range goes through: Backspace, Delete, cut,
 * typing, an IME composition, paste, and a command key such as Enter. It removes what the range
 * covers, puts the insertion where the removal left the caret (a line of text inside one cell is
 * one write instead) and lands one caret, all as one undo entry; a paste is one answer of the
 * range-edit core over the range's bytes. A composition over a widget selected whole removes the
 * widget through it too. The rules by gesture and coverage are `docs/design/selection.md`
 * § Cross-block selection.
 */

import type { AnyBlockKind, CstNode, Document } from '../../core/nodes';
import { documentLineEnding, firstLineEnding } from '../../core/lines';
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
	breaksLine,
	commandGesture,
	commandLandingKind,
	commitRemoval,
	emptiedPlace,
	removalAnswer,
	removedIn,
	removeThroughCore,
	writeInCell,
	type Removed
} from './range-removal';
import {
	answeredAhead,
	landAnswer,
	pasteAnswer,
	pasteInBlock,
	pasteThroughCore,
	type Clip
} from './range-paste';
import {
	answeredBytes,
	endsOf,
	placeInBlock,
	placeOfGap,
	placeOverRange,
	type DocumentBytes,
	type PastePlace
} from '../range-bytes';
import { answeredDocument } from '../../range-edit/host';
import { splicedBytes } from '../../tree-operations/spliced-openers';
import { hidesDelimitersAtCaret } from '../../presentation-mode';
import { parseReplacement } from '../../tree-operations/paste/replacement-parse';
import { slotReaderAt } from '../../tree-operations/list/task-paragraph';
import { dispatchKeyCommand } from '../../schema/block-commands';
import { blockFacts } from '../../schema/block-facts';
import { assertInvariant, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { checkCommandLanding } from '../../invariants/command-key-landing';
import { checkBreakLanding } from '../../invariants/range-break-landing';

// ── Public API ─────────────────────────────────────────────────────────────

/** What a gesture puts where the range was; `none` names the gesture, which picks the side a
 *  caret takes when a block goes whole. */
export type RangeInsertion =
	| { kind: 'none'; gesture: RemovalGesture }
	| { kind: 'text'; text: string }
	| { kind: 'paste'; clip: Clip }
	| { kind: 'composition' }
	| { kind: 'command'; chord: string }
	/** A line break that came as input, not as a key the range claimed: a soft keyboard's, or one a
	 *  key's default sent. `chord` is the key it stands for. */
	| { kind: 'break'; chord: 'Enter' | 'Shift+Enter' };

/** Every insertion but a paste, which the range-edit core answers whole. */
type KeyedInsertion = Exclude<RangeInsertion, { kind: 'paste' }>;

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
	return replaceHeld(ctx, { anchor, focus, start }, insertion);
}

/** What a composition started over a widget selected whole does first: the widget's bytes go as
 *  a range over them would. Typed text there is the block's own splice (`widget-interaction.ts`). */
export async function replaceWidget(
	ctx: CrossBlockMutationContext,
	insertion: Extract<RangeInsertion, { kind: 'composition' }>
): Promise<RangeReplaceOutcome> {
	const widget = ctx.selection.widgetRange();
	if (!widget) return 'nothing';
	const start = { path: widget.path, offset: widget.start };
	const focus = { path: widget.path, offset: widget.end };
	return replaceHeld(ctx, { anchor: start, focus, start }, insertion);
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

/** The bytes a selection the editor holds covers, and its start. */
interface HeldSpan {
	anchor: SelectionPoint;
	focus: SelectionPoint;
	start: SelectionPoint;
}

async function replaceHeld(
	ctx: CrossBlockMutationContext,
	held: HeldSpan,
	insertion: RangeInsertion
): Promise<RangeReplaceOutcome> {
	if (!ctx.controller.admitsGesture(refusalName(insertion))) return 'refused';
	ctx.caretMemory.forget();
	ctx.selection.resetSelectAllCount();
	if (insertion.kind === 'paste' && !insertion.clip.text) return 'nothing';

	const doc = ctx.getDoc();
	const coverage = rangeCoverage(doc, coverRange(doc, held.anchor, held.focus));
	// Widened, since the step assigns it inside a callback the compiler can't follow.
	let outcome = 'nothing' as RangeReplaceOutcome;
	// Seeded with the selection, so one Ctrl+Z puts it back as it stood.
	await ctx.controller.undoStep(deleteSnapshot(held.start.path, held.start.offset), async () => {
		// The step has read the selection for its entry by now, so a selected widget ends here.
		ctx.selection.clearWidget();
		outcome =
			insertion.kind === 'paste'
				? await pasteOver(ctx, coverage, insertion.clip, held.start)
				: await replaceInStep(ctx, coverage, insertion);
	});
	// After the step, whose end starts a new typing batch: the composed text joins the removal.
	if (insertion.kind === 'composition' && outcome === 'written') {
		ctx.controller.continueTypingBurst();
	}
	return outcome;
}

/** Every commit's caret is held, so the replace puts down one: the last commit's that wrote, else
 *  the removal's. A command key is the removal and then the key, so its block lands its own too. */
async function replaceInStep(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	insertion: KeyedInsertion
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

	const keyed = 'chord' in insertion ? insertion : null;
	const claimed = keyed ? commandLandingKind(ctx.getDoc(), coverage) : null;
	const gesture =
		keyed && claimed ? commandGesture(claimed, keyed, ctx.commands) : coreGestureOf(insertion);
	const [removed, held] = await ctx.controller.holdLandings(() =>
		removeRange(ctx, coverage, removal, gesture)
	);
	if (!removed.wrote && !removed.caret) return 'nothing';
	const removalCaret = held ?? (removed.wrote ? null : caretAt(ctx, removed.caret!));
	const place = family !== 'structural' ? emptiedPlace(ctx.bytes.measured(), removed) : null;
	if (place) return insertInEmptiedPlace(ctx, insertion, place, removalCaret);

	const at = removed.caret;
	if (keyed) {
		// Before the command runs, since the block reads the caret to run it.
		await removalCaret?.place();
		const gap = ctx.selection.gapCaret;
		if (gap) return keyAtGap(ctx, [...gap.parentPath, gap.index], keyed.chord);
		const path = at?.path ?? coverage.range.start.path;
		const ran = () => kindOfPath(path, ctx.getDoc());
		// A line break can land past the block it was claimed in (an emptied line, a block read
		// again), so it is held to breaking a line where it runs instead.
		if (gesture === 'break') {
			// A start block the removal kept holds the caret where the range began: no landing to check.
			if (!removed.wrote || removed.taken) {
				assertInvariant('range-break-landing', () =>
					checkBreakLanding(ctx.getDoc(), path, breaksLine(ran(), keyed.chord, ctx.commands))
				);
			}
		} else if (claimed) {
			assertInvariant('command-key-landing', () => checkCommandLanding(claimed, ran()));
		}
		await runCommandAt(ctx, path, keyed.chord);
		return 'written';
	}
	if (insertion.kind === 'none') {
		await removalCaret?.place();
		return 'written';
	}
	return insertAtCaret(ctx, insertion, at, removalCaret);
}

/** A command key where the removal left the caret in a gap, at `slot`, with no block to run in:
 *  Enter opens an empty paragraph there, as `GapCaret.svelte` answers it, and no other key runs. */
async function keyAtGap(
	ctx: CrossBlockMutationContext,
	slot: number[],
	chord: string
): Promise<RangeReplaceOutcome> {
	if (chord === 'Enter' || chord === 'Shift+Enter')
		await ctx.pasteCoordinator.insertParagraph(slot, '');
	return 'written';
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
	insertion: KeyedInsertion,
	at: SelectionPoint | null,
	caretLanding: HeldLanding | null
): Promise<RangeReplaceOutcome> {
	const typed =
		insertion.kind === 'text' && at
			? await typedByBlock(ctx, at, insertion.text, caretLanding)
			: null;
	if (typed) return typed;
	const text = insertion.kind === 'text' ? insertion.text : '';
	const [, insertionLanding] = await ctx.controller.holdLandings(() => insertAt(ctx, at, text));
	await (insertionLanding ?? caretLanding)?.place();
	return 'written';
}

/** The insertion in an empty paragraph opened where the range was, at `place`. A paragraph that
 *  can't open drops the text, since the removal's caret sits on a block's syntax. */
async function insertInEmptiedPlace(
	ctx: CrossBlockMutationContext,
	insertion: KeyedInsertion,
	place: number[],
	removalCaret: HeldLanding | null
): Promise<RangeReplaceOutcome> {
	const [opened, landing] = await ctx.controller.holdLandings(() =>
		ctx.pasteCoordinator.insertParagraph(place, '')
	);
	if (opened) return insertAtCaret(ctx, insertion, { path: place, offset: 0 }, landing);
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
function familyOf(insertion: KeyedInsertion): Family {
	switch (insertion.kind) {
		case 'none':
		case 'command':
		case 'break':
			return 'structural';
		case 'text':
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
	gesture: CoreGesture
): Promise<Removed> {
	const grid = coverage.grid;
	if (grid && removal === 'remove-lines' && (grid.kind === 'row' || grid.kind === 'column'))
		return commitGridLineDelete(ctx, grid).then(inCell);
	if (grid && removal !== 'remove-whole') return commitGridClear(ctx, coverage, grid).then(inCell);
	return removeThroughCore(ctx, coverage, gesture);
}

const inCell = (caret: SelectionPoint | null): Removed => ({
	wrote: caret !== null,
	caret,
	landed: null,
	taken: null
});

/** How the core names the removal any other gesture makes (`commandGesture` names a key's): typed
 *  text as a cut, a composition as Delete, a delete no key asked for as Backspace. */
function coreGestureOf(insertion: KeyedInsertion): CoreGesture {
	switch (insertion.kind) {
		case 'none':
			return CORE_GESTURE[insertion.gesture];
		case 'text':
			return insertion.text ? 'type' : 'command';
		case 'composition':
			return 'compose';
		case 'command':
			return 'command';
		case 'break':
			return 'break';
	}
}

// ── The insertion ──────────────────────────────────────────────────────────

/** The text parsed in the unit's slot, read as a reload reads it there, so a marker typed over
 *  the unit makes its kind. */
async function replaceUnit(
	ctx: CrossBlockMutationContext,
	unitPath: number[],
	insertion: KeyedInsertion
): Promise<RangeReplaceOutcome> {
	const doc = ctx.getDoc();
	const unit = blockNodeAt(doc, unitPath);
	if (!unit || insertion.kind !== 'text') return 'nothing';
	const read = slotReaderAt(doc, unitPath, ctx.reading.grammar);
	const parsed = parseReplacement(unit, insertion.text, documentLineEnding(doc), read);
	if (!parsed) return 'nothing';
	ctx.selection.collapse();
	const landed = await ctx.pasteCoordinator.replaceBlock(
		unitPath,
		parsed.replacement,
		{ replacementIndex: parsed.replacement.length - 1, offset: CURSOR_END },
		// The undo step records the range, so the offset is never read.
		{ source: 'cross-block-covered-block', trailingBlank: parsed.suffix !== '', snapshotOffset: 0 }
	);
	return landed === null ? 'nothing' : 'written';
}

/** Text over a range inside one table cell, as one write of the cell, the way a mouse's range there
 *  takes it: removed first, the cell would drop the space the removal leaves. Null elsewhere. */
async function replaceInCell(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	insertion: KeyedInsertion
): Promise<RangeReplaceOutcome | null> {
	if (insertion.kind !== 'text') return null;
	const { start, end } = coverage.range;
	const row = blockNodeAt(ctx.getDoc(), start.path.slice(0, -1));
	if (!row || !pathsEqual(start.path, end.path) || blockFacts(row.kind).lines !== 'cells')
		return null;
	const [wrote, landing] = await ctx.controller.holdLandings(() =>
		writeInCell(ctx, coverage, insertion.text)
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

/** Text into a block with no typing write of its own goes through the reparsing commit, so a
 *  marker at offset 0 still makes the kind. */
async function insertAt(
	ctx: CrossBlockMutationContext,
	caret: SelectionPoint | null,
	text: string
): Promise<void> {
	const leaf = caret && blockNodeAt(ctx.getDoc(), caret.path);
	if (!text || !caret || !leaf) return;
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

// ── A paste ────────────────────────────────────────────────────────────────

/** A paste over the range, the range-edit core's one answer over its bytes. Cells of one table
 *  are the grid's to clear first, unless their kind answers the paste itself. */
async function pasteOver(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	clip: Clip,
	started: SelectionPoint
): Promise<RangeReplaceOutcome> {
	const undo = deleteSnapshot(started.path, started.offset);
	const { start, end } = coverage.range;
	const grid = coverage.grid;
	if (grid && grid.kind !== 'table') {
		const { rect } = grid;
		if (await answeredAhead(ctx, [...grid.path, rect.top, rect.left], clip, rect)) {
			ctx.selection.collapse();
			return 'written';
		}
		const [cell, cleared] = await ctx.controller.holdLandings(() =>
			commitGridClear(ctx, coverage, grid)
		);
		if (!cell) return 'nothing';
		const wrote = await pasteInBlock(ctx, { path: cell.path, start: 0, end: 0 }, clip, undo);
		if (!wrote) await cleared?.place();
		return 'written';
	}
	const inOneBlock = pathsEqual(start.path, end.path) && coverage.wholeRoots.length === 0;
	if (inOneBlock && !grid) {
		const within = { path: start.path, start: start.offset, end: end.offset };
		return (await pasteInBlock(ctx, within, clip, undo)) ? 'written' : 'refused';
	}
	// One block held whole gives its line to the paste, in one answer of the core.
	if (pathsEqual(start.path, end.path) || grid) {
		const aim = { named: endsOf(coverage), place: () => placeOverRange(ctx.bytes, coverage) };
		return (await pasteThroughCore(ctx, aim, clip, undo)) ? 'written' : 'refused';
	}
	// The pair is answered whole before either commits, so the removal goes only with a paste.
	const pair = pairOver(ctx, coverage, clip);
	if (!pair) return 'nothing';
	const [removed, removalCaret] = await ctx.controller.holdLandings(() =>
		commitRemoval(ctx, coverage, 'type', pair.removal)
	);
	if (!removed.wrote && !removed.caret) return 'nothing';
	// The paste's own commit names a block of the document the removal left.
	const left = removed.caret ?? { path: [0], offset: 0 };
	const after = deleteSnapshot(left.path, left.offset);
	const wrote = pair.lands && (await landAnswer(ctx, pair.left.source, pair.paste, after));
	if (!wrote) await (removalCaret ?? (removed.caret && caretAt(ctx, removed.caret)))?.place();
	return 'written';
}

/** The removal typing over the range makes, then the paste at the place the editor would hold on
 *  the bytes it leaves, both answered before either commits; null where the paste has no place. */
function pairOver(ctx: CrossBlockMutationContext, coverage: RangeCoverage, clip: Clip) {
	const removal = removalAnswer(ctx, coverage, 'type');
	if (!removal) return null;
	const { read, answer } = removal;
	const { source } = read;
	const { grammar } = ctx.reading;
	const written = splicedBytes(read.measured, source, answer.source, grammar);
	const left = answeredDocument(ctx.reading, read, written);
	const bytes = answeredBytes(left);
	const removed = removedIn(bytes, answer, written !== source);
	const at = placeAfterRemoval(bytes, removed, hidesDelimitersAtCaret(ctx.reading.mode()));
	if (!at) return null;
	// Read before the removal, which may take every line ending the document has.
	const ending = firstLineEnding(source) ?? undefined;
	const paste = pasteAnswer(ctx, left, { ...at, ending }, clip);
	return { removal, left, paste, lands: paste.source !== left.source };
}

/** Where a paste goes on `bytes`, what the removal leaves: the boundary the editor holds its caret
 *  at, else the caret's text, else the place the core named for a caret on a block. */
function placeAfterRemoval(
	bytes: DocumentBytes,
	removed: Removed,
	live: boolean
): PastePlace | null {
	const slot = emptiedPlace(bytes.measured(), removed);
	if (slot) return placeOfGap(bytes, { parentPath: slot.slice(0, -1), index: slot.at(-1)! });
	const { landed, caret } = removed;
	// A document the removal emptied has no block to hold a caret, so the core's landing is the place.
	if (landed?.holds === 'block' || (landed && bytes.doc().children.length === 0)) {
		const { at, ...held } = landed;
		return { range: { from: at, to: at }, ...held };
	}
	if (!caret) return null;
	const at = charOffsetOf(caret, 'range-replace:paste');
	return placeInBlock(bytes, caret.path, at, at, live);
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

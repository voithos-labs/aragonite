/**
 * The one replace every destructive gesture over a live range goes through: Backspace, Delete, cut,
 * typing, an IME composition, paste, and a command key such as Enter. It removes what the range
 * covers, puts the insertion where the removal left the caret (a line of text inside one cell is
 * one write instead) and lands one caret, all as one undo entry; a paste, and text across blocks,
 * are one answer of the range-edit core over the range's bytes, and a composition waits at the
 * place that core names for text. A composition over a widget selected whole removes the
 * widget through it too. The rules by gesture and coverage are `docs/design/selection.md`
 * § Cross-block selection.
 */

import type { AnyBlockKind, CstNode, Document } from '../../core/nodes';
import { isBlankText } from '../../core/lines';
import type { HeldLanding, SpliceCaret } from '../../action-contracts';
import type { CrossBlockDispatchContext } from './dispatch';
import { charOffsetOf, deleteSnapshot, type SelectionPoint } from '../primitives';
import { coverRange, rangeCoverage, type RangeCoverage } from '../range-coverage';
import type { RemovalGesture } from '../caret-target';
import type { RemovalGesture as CoreGesture, RangeEditResult } from '../../range-edit/edit-range';
import { docPathFrom } from '../../core/coordinate-spaces';
import { pathsEqual } from '../path-math';
import { blockNodeAt, isBlockNode } from '../../tree-operations/node-primitives';
import { commitGridClear, commitGridLineDelete } from './grid-removal';
import {
	CORE_GESTURE,
	bindsLineBreak,
	breaksIn,
	commandLandingKind,
	commitBytes,
	commitRemoval,
	emptiedPlace,
	removeThroughCore,
	splitsParagraph,
	writeInCell,
	type CoreCommit,
	type Removed
} from './range-removal';
import {
	answeredAhead,
	currentPlace,
	overRangeAnswer,
	pasteInBlock,
	pasteThroughCore,
	placeKind,
	type PlaceAnswer,
	type SpendInsertion
} from './range-paste';
import { endsOf, placeOverRange, pointAtByte } from '../range-bytes';
import type { RangeHost } from '../../range-edit/host';
import { dispatchKeyCommand } from '../../schema/block-commands';
import { completeLineOnType } from '../../schema/block-completions';
import { blockFacts } from '../../schema/block-facts';
import { assertInvariant, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { checkCommandLanding } from '../../invariants/command-key-landing';
import type { RewrittenClip } from '../../tree-operations/paste/paste-rewrites';

// ── Public API ─────────────────────────────────────────────────────────────

/** What a gesture puts where the range was; `none` names the gesture, which picks the side a
 *  caret takes when a block goes whole. */
export type RangeInsertion =
	| { kind: 'none'; gesture: RemovalGesture }
	| { kind: 'text'; text: string }
	| { kind: 'paste'; clip: RewrittenClip }
	| { kind: 'composition' }
	/** `place`: the core's place the key's claim asked for, run on while the document holds the
	 *  bytes it read. */
	| { kind: 'command'; chord: string; place: PlaceAnswer | null }
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
	| 'kindCue'
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
	const step = async () => {
		// The step has read the selection for its entry by now, so a selected widget ends here.
		ctx.selection.clearWidget();
		outcome =
			insertion.kind === 'paste'
				? await pasteOver(ctx, coverage, insertion.clip, held.start)
				: await replaceInStep(ctx, coverage, insertion);
	};
	const seed = deleteSnapshot(held.start.path, held.start.offset);
	// Text over the editor's own range inside one block undoes to where it began, as the browser's
	// range does; anything else puts the selection back as it stood.
	if (textInOneBlock(ctx, insertion)) await ctx.controller.undoStepFrom(seed, step);
	else await ctx.controller.undoStep(seed, step);
	// After the step, whose end starts a new typing batch: the composed text joins the removal.
	if (insertion.kind === 'composition' && outcome === 'written') {
		ctx.controller.continueTypingBurst();
	}
	return outcome;
}

/** Typed, composed or one-line pasted text over a range the editor holds inside one block. */
function textInOneBlock(ctx: CrossBlockMutationContext, insertion: RangeInsertion): boolean {
	if (!ctx.selection.ownsRange || !ctx.selection.rangeInOneBlock) return false;
	if (insertion.kind === 'paste') return !/[\r\n]/.test(insertion.clip.text);
	return insertion.kind === 'text' || insertion.kind === 'composition';
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
	const inCell = family === 'content' ? await replaceInCell(ctx, coverage, insertion) : null;
	if (inCell !== null) return inCell;
	if (overBlocks(coverage)) {
		if (insertion.kind === 'text' && insertion.text) {
			const { text } = insertion;
			return withLandingStep(ctx, coverage, (spend) => textOverRange(ctx, coverage, text, spend));
		}
		// A table held whole keeps its cells for the IME, emptied, the first one taking the text.
		if (insertion.kind === 'composition' && !coverage.grid) return compositionPlace(ctx, coverage);
	}

	const keyed = 'chord' in insertion ? insertion : null;
	// A cell's rows or columns have no place for text: their keys run in the cell the removal leaves.
	const over =
		keyed && (keyed.kind === 'break' || bindsLineBreak(keyed.chord, ctx.commands))
			? currentPlace(ctx, coverage, keyed.kind === 'command' ? keyed.place : null)
			: null;
	// A key the place binds to anything but a line break runs as any other command key does.
	if (keyed && over && breaksIn(placeKind(over), keyed, ctx.commands))
		return breakAtPlace(ctx, coverage, over, keyed.chord);
	const claimed = keyed ? commandLandingKind(ctx.getDoc(), coverage) : null;
	const [removed, held] = await ctx.controller.holdLandings(() =>
		removeRange(ctx, coverage, removal, coreGestureOf(insertion))
	);
	if (!removed.wrote && !removed.caret) return 'nothing';
	const removalCaret = held ?? (removed.wrote ? null : caretAt(ctx, removed.caret!));
	// Text over the editor's own range inside one leaf, or a table's cells: the paragraph a removal
	// that emptied a line beside a block's syntax opens first.
	const anyProse = family === 'composition' && reachOf(coverage) === 'unit';
	const place =
		family !== 'structural' ? emptiedPlace(ctx.bytes.measured(), removed, anyProse) : null;
	if (place) return insertInEmptiedPlace(ctx, insertion, place, removalCaret);
	const at = removed.caret;
	if (keyed) {
		// Before the command runs, since the block reads the caret to run it.
		await removalCaret?.place();
		// At a gap there is no block to run the command in, so the key stops at the removal.
		if (ctx.selection.gapCaret) return 'written';
		const path = at?.path ?? coverage.range.start.path;
		if (claimed) {
			const ran = kindOfPath(path, ctx.getDoc());
			assertInvariant('command-key-landing', () => checkCommandLanding(claimed, ran));
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

/** A line break at the core's place for text over the range, then the key's own command there, in
 *  one undo step; Enter's split is a paragraph the place opened already. */
async function breakAtPlace(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	over: PlaceAnswer,
	chord: string
): Promise<RangeReplaceOutcome> {
	const placed = await commitPlace(ctx, coverage, over);
	if (!placed) return 'nothing';
	if (over.answer.opened && splitsParagraph(chord, ctx.commands)) return 'written';
	const gap = ctx.selection.gapCaret;
	if (gap) return breakWhereRangeWas(ctx, [...gap.parentPath, gap.index], chord);
	await runCommandAt(ctx, placed.caret?.path ?? coverage.range.start.path, chord);
	return 'written';
}

/** The core's place for text over the range committed as its removal is, the caret put down there:
 *  where a composition waits and a line break runs. Null where it took nothing and no caret stands. */
async function commitPlace(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	{ read, answer }: PlaceAnswer
): Promise<Removed | null> {
	const unlanded = { ...answer, unlanded: answer.caret.at };
	const [removed, held] = await ctx.controller.holdLandings(() =>
		commitRemoval(ctx, coverage, 'compose', { read, answer: unlanded })
	);
	if (!removed.wrote && !removed.caret) return null;
	await (held ?? (removed.caret && caretAt(ctx, removed.caret)))?.place();
	return removed;
}

/** A line break with no block to run in lands in an empty paragraph at `slot`, one an emptied
 *  document or container keeps or a new one; any break but Enter's split then runs there. */
async function breakWhereRangeWas(
	ctx: CrossBlockMutationContext,
	slot: number[],
	chord: string
): Promise<RangeReplaceOutcome> {
	const there = blockNodeAt(ctx.getDoc(), slot);
	if (there?.kind === 'paragraph' && isBlankText(there.raw))
		await caretAt(ctx, { path: slot, offset: 0 }).place();
	else await ctx.pasteCoordinator.insertParagraph(slot, '');
	if (!splitsParagraph(chord, ctx.commands)) await runCommandAt(ctx, slot, chord);
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

/** `write`, the core's text over the range, through the step of the block it lands in, held once: the
 *  block the range starts in where it keeps its head, else the one it ends in where it keeps its tail. */
async function withLandingStep(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	write: (spend: SpendInsertion | null) => Promise<RangeReplaceOutcome>
): Promise<RangeReplaceOutcome> {
	const path = coverage.startEdge?.path ?? coverage.endEdge?.path;
	const step = path ? (await ctx.caretLanding.mount(path))?.holdInsertion?.() : undefined;
	let outcome: RangeReplaceOutcome = 'nothing';
	try {
		outcome = await write(step?.spend ?? null);
	} finally {
		step?.finish(outcome === 'written');
	}
	return outcome;
}

/** Text over a range across blocks or over a block it holds whole, as one answer of the core in one
 *  commit; a key's line an on-type completer takes then completes as the block's own write. */
async function textOverRange(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	text: string,
	spend: SpendInsertion | null
): Promise<RangeReplaceOutcome> {
	const over = overRangeAnswer(ctx, coverage, { text, spend });
	if (!over || over.answer.source === over.read.source) return 'nothing';
	const { answer, host } = over;
	const { start, end } = coverage.range;
	// One block held whole is replaced where it stands, so its event names it, nested or not.
	const op: CoreCommit['op'] = pathsEqual(start.path, end.path)
		? {
				kind: 'replaceBlock',
				detail: { source: 'cross-block-covered-block' },
				eventPath: docPathFrom(start.path)
			}
		: typedOp(host, answer);
	const snapshot = deleteSnapshot(start.path, start.offset);
	const [wrote, landing] = await ctx.controller.holdLandings(() =>
		commitBytes(ctx, answer.source, { caret: answer.caret, op, snapshot })
	);
	await landing?.place();
	if (!wrote) return 'refused';
	if (answer.into)
		void ctx.kindCue.afterTypedWrite(Promise.resolve(), answer.into.path, answer.into.kind);
	await completedOnType(ctx, answer.caret);
	return 'written';
}

/** The edit a key's text over a range across blocks names: the top-level block it landed in, a path
 *  the document before the write still resolves, and that block's length after the write. */
function typedOp(host: RangeHost, answer: RangeEditResult): CoreCommit['op'] {
	const tree = host.read(answer.source);
	const top = host.layout(tree).leafAt(answer.caret.at)?.path[0];
	const length = (top !== undefined && tree.children[top]?.raw.length) || 0;
	const op = { kind: 'updateContent', detail: { length, crossBlock: true } } as const;
	return top === undefined ? op : { ...op, eventPath: docPathFrom([top]) };
}

/** Where a composition over a range across blocks or a block held whole writes: the core's place,
 *  committed as the removal is, the caret put there before the IME's first write. */
async function compositionPlace(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage
): Promise<RangeReplaceOutcome> {
	const over = overRangeAnswer(ctx, coverage, 'place');
	return over && (await commitPlace(ctx, coverage, over)) ? 'written' : 'nothing';
}

/** The line a typed key left at `caret`, completed as the block completes a line typed there where
 *  an on-type completer takes it (a lone `$$`). */
async function completedOnType(ctx: CrossBlockMutationContext, caret: SpliceCaret): Promise<void> {
	if (caret.holds !== 'text') return;
	const point = pointAtByte(ctx.bytes.measured(), caret.at);
	const raw = point ? blockNodeAt(ctx.getDoc(), point.path)?.raw : undefined;
	if (!point || raw === undefined) return;
	const lineStart = raw.lastIndexOf('\n', point.offset - 1) + 1;
	const lineEnd = raw.indexOf('\n', point.offset);
	const line = raw.slice(lineStart, lineEnd < 0 ? raw.length : lineEnd).replace(/\r$/, '');
	if (!completeLineOnType(line, ctx.reading.grammar)) return;
	const block = await ctx.caretLanding.mount(point.path);
	await block?.typeText?.('', point.offset);
}

/** A range across blocks, or one holding a block whole: the core's. A table's rows and cells share
 *  its path and hold no block whole, and neither does a paragraph's whole text. */
function overBlocks(coverage: RangeCoverage): boolean {
	const { start, end } = coverage.range;
	return !pathsEqual(start.path, end.path) || coverage.wholeRoots.length === 1;
}

/** Keyed gestures name themselves in reading mode's dev warning; a cut or a paste is refused
 *  quietly, as the clipboard refuses reading mode. */
function refusalName(insertion: RangeInsertion): string | null {
	if (insertion.kind === 'paste') return null;
	if (insertion.kind === 'none') return insertion.gesture === 'cut' ? null : 'rangeDelete';
	return `rangeReplace:${insertion.kind}`;
}

// ── The removal, picked by insertion family and coverage ───────────────────

/** Structural gestures remove what Backspace removes; content and a composition, which the core
 *  answers whole over blocks, clear a table's cells by the grid. */
type Family = 'structural' | 'content' | 'composition';

/** What the range holds: one block whole (a table, a rule), whole rows or columns of one table,
 *  a rectangle of its cells, or anything else. */
type Reach = 'unit' | 'lines' | 'cells' | 'other';

/** Removes what the range covers and keeps what it can, takes the blocks it holds whole out, or
 *  takes a table's whole rows or columns. */
type RangeRemoval = 'delete' | 'remove-whole' | 'remove-lines';

const STRUCTURAL_REMOVAL: Record<Reach, RangeRemoval> = {
	unit: 'remove-whole',
	lines: 'remove-lines',
	cells: 'delete',
	other: 'delete'
};

const REMOVAL: Record<Family, Record<Reach, RangeRemoval>> = {
	structural: STRUCTURAL_REMOVAL,
	content: { unit: 'delete', lines: 'delete', cells: 'delete', other: 'delete' },
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
	removal: RangeRemoval,
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

/** How the core names the removal a gesture makes: a delete no key asked for removes as a command
 *  key does, from the side Backspace takes. */
function coreGestureOf(insertion: KeyedInsertion): CoreGesture {
	switch (insertion.kind) {
		case 'none':
			return CORE_GESTURE[insertion.gesture];
		case 'text':
			return insertion.text ? 'type' : 'command';
		case 'composition':
			return 'compose';
		case 'command':
		case 'break':
			return 'command';
	}
}

// ── The insertion ──────────────────────────────────────────────────────────

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
	clip: RewrittenClip,
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
		// An emptied cell has no hidden edge for a block's step to move the text across.
		const at = { path: cell.path, start: 0, end: 0 };
		const wrote = await pasteInBlock(ctx, at, clip, undo, null);
		if (!wrote) await cleared?.place();
		return 'written';
	}
	if (pathsEqual(start.path, end.path) && coverage.wholeRoots.length === 0 && !grid) {
		// Inside one block the join places the text (`live-mode.md` § 4.5).
		const within = { path: start.path, start: start.offset, end: end.offset };
		return (await pasteInBlock(ctx, within, clip, undo, null)) ? 'written' : 'refused';
	}
	// Across blocks, or over one block held whole, the paste lands where text over the range goes.
	const aim = { named: endsOf(coverage), place: () => placeOverRange(ctx.bytes, coverage) };
	return withLandingStep(ctx, coverage, async (spend) =>
		(await pasteThroughCore(ctx, aim, clip, undo, spend)) ? 'written' : 'refused'
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

/**
 * The one replace every destructive gesture over a live range goes through: Backspace, Delete, cut,
 * typing, an IME composition, paste, and Enter, Tab or Mod+digit. It removes what the range covers
 * in one commit picked by that coverage, puts the insertion where the removal left the caret, and
 * lands one caret, all as one undo entry (`docs/design/editor.md` § Cross-block selection).
 */

import type { AnyBlockKind, CstNode, Document } from '../../core/nodes';
import { documentLineEnding } from '../../core/lines';
import { CURSOR_END } from '../../block-component';
import type { MultiScopeTarget } from '../../action-contracts';
import type { CrossBlockDispatchContext } from './dispatch';
import { charOffsetOf, deleteSnapshot, type SelectionPoint } from '../primitives';
import { rangeDelete, removeHeldWhole, type RangeDeleteResult } from '../range-delete';
import { coverRange, rangeCoverage, type RangeCoverage } from '../range-coverage';
import { commitGridLineDelete } from '../range-delete-table-coverage';
import type { RemovalGesture } from '../caret-target';
import { pathsEqual } from '../path-math';
import { trackChildIds, type StructuralChange } from '../../tree-operations/structural-change';
import {
	blockNodeAt,
	documentBody,
	isBlockNode,
	nodeAt
} from '../../tree-operations/node-primitives';
import type { SharingState } from '../../tree-operations/sharing';
import { pasteDispatch } from '../../tree-operations/paste/dispatch';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import { parseReplacement } from '../../tree-operations/paste/replacement-parse';
import { slotReaderAt } from '../../tree-operations/list/task-paragraph';
import { countsCells } from '../../schema/block-kind-descriptor';
import { dispatchKeyCommand } from '../../schema/block-commands';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { getStateForNode } from '../../reactivity/state-registry';
import { emitClipboardError } from '../../editor-events';

// ── Public API ─────────────────────────────────────────────────────────────

/** What a gesture puts where the range was; `none` names the gesture, which picks the side a
 *  caret takes when a block goes whole. */
export type RangeInsertion =
	| { kind: 'none'; gesture: RemovalGesture }
	| { kind: 'text'; text: string }
	| { kind: 'paste'; text: string }
	| { kind: 'composition' }
	| { kind: 'command'; chord: string };

/** `refused`: reading mode, or a document a `source` swap replaced. */
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
>;

/**
 * Removes what the live range covers and puts `insertion` where that leaves the caret. Nothing
 * awaits before the removal's commit, so a composition's start deletes before the IME writes.
 */
export async function replaceRange(
	ctx: CrossBlockMutationContext,
	insertion: RangeInsertion
): Promise<RangeReplaceOutcome> {
	const { anchor, focus, start } = ctx.selection;
	if (!ctx.selection.isCrossBlock || !anchor || !focus || !start) return 'nothing';
	if (!ctx.controller.admitsGesture(refusalName(insertion))) return 'refused';
	ctx.caretMemory.forget();
	ctx.selection.resetSelectAllCount();
	if (insertion.kind === 'paste' && !insertion.text) return 'nothing';

	const doc = ctx.getDoc();
	const coverage = rangeCoverage(doc, coverRange(doc, anchor, focus));
	let outcome: RangeReplaceOutcome = 'nothing';
	// Seeded with the range, so one Ctrl+Z puts it back as it stood.
	await ctx.controller.undoStep(deleteSnapshot(start.path, start.offset), async () => {
		outcome = await replaceInStep(ctx, coverage, insertion);
	});
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

async function replaceInStep(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	insertion: RangeInsertion
): Promise<RangeReplaceOutcome> {
	const text = insertedText(insertion);
	const unit = text ? unitHeldWhole(coverage) : null;
	if (unit) return replaceUnit(ctx, unit, insertion, text);

	// Typed text and a paste land their own caret; the removal lands it for the rest, but a
	// composition, whose caret the IME owns.
	const removalLands = !text && insertion.kind !== 'composition';
	const removing = removeRange(ctx, coverage, insertion, removalLands);
	if (insertion.kind === 'composition') ctx.controller.continueTypingBurst();
	const removed = await removing;
	if (!removed.wrote) return 'nothing';

	const caret = removed.caret;
	if (insertion.kind === 'command') {
		await runCommandAt(ctx, caret?.path ?? coverage.range.start.path, insertion.chord);
	} else if (text && caret) {
		await (insertion.kind === 'paste' ? pasteAt(ctx, caret, text) : typeAt(ctx, caret, text));
	} else if (text && insertion.kind === 'paste') {
		// Consumed with nowhere to go: an imported image isn't on the clipboard, so say so.
		emitClipboardError(ctx.events, {
			error: new Error('cross-block paste resolved no caret; nothing inserted'),
			path: coverage.range.start.path.slice()
		});
	}
	return 'written';
}

/** Keyed gestures name themselves in reading mode's dev warning; a cut or a paste is refused
 *  quietly, as the clipboard refuses reading mode. */
function refusalName(insertion: RangeInsertion): string | null {
	if (insertion.kind === 'paste') return null;
	if (insertion.kind === 'none') return insertion.gesture === 'cut' ? null : 'rangeDelete';
	return `rangeReplace:${insertion.kind}`;
}

function insertedText(insertion: RangeInsertion): string {
	return insertion.kind === 'text' || insertion.kind === 'paste' ? insertion.text : '';
}

/** The one block both endpoints sit in and the range holds whole, a table included: no leaf
 *  survives it to take the text, so the text replaces it in its slot. */
function unitHeldWhole(coverage: RangeCoverage): number[] | null {
	const { start, end } = coverage.range;
	if (!pathsEqual(start.path, end.path) || coverage.wholeRoots.length !== 1) return null;
	return coverage.wholeRoots[0].slice();
}

// ── The removal ────────────────────────────────────────────────────────────

interface Removed {
	wrote: boolean;
	/** Where the removal left the caret, read on the committed tree. */
	caret: SelectionPoint | null;
}

/** Picked by what the range covers: with nothing to insert, a whole row or column and a table
 *  held whole go structurally; everything else, a grid's cells included, goes by `rangeDelete`. */
function removeRange(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	insertion: RangeInsertion,
	lands: boolean
): Promise<Removed> {
	const gesture = insertion.kind === 'none' ? insertion.gesture : 'keyless';
	const grid = insertion.kind === 'none' ? coverage.grid : null;
	if (grid?.kind === 'row' || grid?.kind === 'column') {
		return commitGridLineDelete(ctx, grid).then((caret) => ({ wrote: caret !== null, caret }));
	}
	return commitRemoval(
		ctx,
		coverage,
		(body, sharing) =>
			grid?.kind === 'table'
				? removeHeldWhole(body, coverage, sharing, ctx.reading, gesture)
				: rangeDelete(body, coverage, sharing, ctx.reading, gesture),
		lands
	);
}

/** One commit over the document and every mounted container either endpoint splices. */
async function commitRemoval(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	remove: (body: Document, sharing: SharingState) => RangeDeleteResult,
	lands: boolean
): Promise<Removed> {
	const { start, end } = coverage.range;
	const doc = ctx.getDoc();
	// The document goes first and always: it holds every endpoint, and a block taken whole at the
	// top level leaves its array.
	const scopes: MultiScopeTarget[] = [
		ctx.controller.getDocScope(),
		...touchedContainers(doc, start.path, end.path)
	];
	let result: RangeDeleteResult | null = null;
	const caret = () => result?.caret(ctx.getDoc()) ?? null;
	const wrote = await ctx.controller.commitMultiScope({
		scopes,
		snapshot: deleteSnapshot(start.path, start.offset),
		mutate: (views) => {
			// The document's view, as a body that carries ids for the ledger below.
			const top = documentBody(doc, views[0].children);
			// Opened before the removal: paths go stale as it splices, the scope nodes don't.
			const ledgers = views.map((v, i) => trackChildIds(i === 0 ? top : v.node));
			const removed = remove(top, views[0].sharing);
			result = removed;
			ctx.selection.collapse();
			// An endpoint table's scope reports the row splice the removal made, matched on the copied
			// node, never a snap worked out again.
			const rowSplices = removed.tableRowSplices ?? [];
			return ledgers.map((ledger, i): StructuralChange => {
				const rowSplice = rowSplices.find((s) => s.table === views[i].node);
				const change = rowSplice
					? ({ op: 'delete', at: rowSplice.at, count: rowSplice.count } as const)
					: ledger.read();
				ledger.release();
				return change;
			});
		},
		op: { kind: 'delete', detail: { crossBlock: true }, eventPath: docPathFrom([start.path[0]]) },
		landing: lands
			? () => {
					const at = caret();
					return at && { path: docPathFrom(at.path), offset: at.offset };
				}
			: undefined
	});
	return { wrote, caret: caret() };
}

/** Every mounted container on either endpoint path whose children the removal splices: the
 *  ancestors, a grid endpoint itself, and none for a range whose ends are both top-level prose. */
function touchedContainers(
	doc: Document,
	startPath: number[],
	endPath: number[]
): MultiScopeTarget[] {
	const touched: MultiScopeTarget[] = [];
	const seen = new Set<string>();
	// A pair on one top-level block, a grid's cells included, splices the document's array alone.
	if (pathsEqual(startPath, endPath) && startPath.length === 1) return touched;

	function visit(leafPath: number[]): void {
		for (let depth = 1; depth <= leafPath.length; depth++) {
			const ancestorPath = leafPath.slice(0, depth);
			const node = nodeAt(doc, ancestorPath);
			if (!node || !isBlockNode(node) || !node.children) continue;
			if (depth === leafPath.length && !countsCells(node)) continue;
			const key = ancestorPath.join('.');
			if (seen.has(key)) continue;
			seen.add(key);
			const state = getStateForNode(node);
			if (!state) continue;
			touched.push({ path: ancestorPath, node, state });
		}
	}

	visit(startPath);
	visit(endPath);
	touched.sort((a, b) => a.path.length - b.path.length || comparePathOrder(a.path, b.path));
	return touched;
}

function comparePathOrder(a: number[], b: number[]): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

// ── The insertion ──────────────────────────────────────────────────────────

/** The text parsed in the unit's slot, read as a reload reads it there, so a marker typed or
 *  pasted over the unit makes its kind. */
async function replaceUnit(
	ctx: CrossBlockMutationContext,
	unitPath: number[],
	insertion: RangeInsertion,
	text: string
): Promise<RangeReplaceOutcome> {
	const doc = ctx.getDoc();
	const unit = blockNodeAt(doc, unitPath);
	if (!unit) return 'nothing';
	// This route skips `pasteDispatch`, so a paste runs the editor's transforms here.
	const bytes = insertion.kind === 'paste' ? applyPasteTransforms(text, ctx.activePlugins) : text;
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

/** Through the write every keystroke takes, so a marker typed at offset 0 makes the kind and the
 *  container's rule escapes what it must. */
async function typeAt(
	ctx: CrossBlockMutationContext,
	caret: SelectionPoint,
	text: string
): Promise<void> {
	const leaf = blockNodeAt(ctx.getDoc(), caret.path);
	if (!leaf) return;
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

/** Every paste route lands its own caret, from the dispatch's own commits. */
async function pasteAt(
	ctx: CrossBlockMutationContext,
	caret: SelectionPoint,
	text: string
): Promise<void> {
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
}

/** At the caret the removal landed, never over stale block indices: a table endpoint's caret is
 *  a cell, which has a `runCommand` where the table has none. */
async function runCommandAt(
	ctx: CrossBlockMutationContext,
	path: number[],
	chord: string
): Promise<void> {
	const target = await ctx.caretLanding.mount(path);
	if (!target?.runCommand) return;
	dispatchKeyCommand(
		chord,
		{ kind: kindOfPath(path, ctx.getDoc()), runCommand: target.runCommand, getPath: () => path },
		ctx.commands
	);
}

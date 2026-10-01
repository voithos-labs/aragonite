/**
 * The one replace every destructive gesture over a live range goes through: Backspace, Delete, cut,
 * typing, an IME composition, paste, and Enter, Tab or Mod+digit. It removes what the range covers
 * in one commit picked by the kind of gesture and that coverage, puts the insertion where the
 * removal left the caret, and lands one caret, all as one undo entry
 * (`docs/design/editor.md` § Cross-block selection).
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
	/** `leafPath`: the leaf the IME composes in. */
	| { kind: 'composition'; leafPath: readonly number[] }
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
	// Widened, since the step assigns it inside a callback the compiler can't follow.
	let outcome = 'nothing' as RangeReplaceOutcome;
	// Seeded with the range, so one Ctrl+Z puts it back as it stood.
	await ctx.controller.undoStep(deleteSnapshot(start.path, start.offset), async () => {
		outcome = await replaceInStep(ctx, coverage, insertion);
	});
	// After the step, whose end starts a new typing batch: the composed text joins the removal.
	if (insertion.kind === 'composition' && outcome === 'written') {
		ctx.controller.continueTypingBurst(insertion.leafPath);
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

/** Every commit's caret is held, so the gesture puts down one: the last commit's that wrote, else
 *  the removal's. A command runs outside the hold, and the block that takes it places its own. */
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

	const [removed, removalLanding] = await ctx.controller.holdLandings(() =>
		removeRange(ctx, coverage, removal, insertion)
	);
	if (!removed.wrote) return 'nothing';
	// The IME owns a composition's caret.
	if (family === 'composition') return 'written';

	const at = removed.caret;
	if (insertion.kind === 'command') {
		const ran = await runCommandAt(ctx, at, at?.path ?? coverage.range.start.path, insertion.chord);
		if (!ran) await removalLanding?.place();
		return 'written';
	}
	const text = insertion.kind === 'text' || insertion.kind === 'paste' ? insertion.text : '';
	const [, insertionLanding] = await ctx.controller.holdLandings(() =>
		insertAt(ctx, at, insertion, text)
	);
	await (insertionLanding ?? removalLanding)?.place();
	if (text && !at && insertion.kind === 'paste') {
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

// ── The removal, picked by insertion family and coverage ───────────────────

/** Structural gestures remove what Backspace removes, content ones put text where the range was,
 *  and a composition never changes block structure: the IME composes in the element it started in. */
type Family = 'structural' | 'content' | 'composition';

/** What the range holds: one block whole (a table, a rule), whole rows or columns of one table,
 *  a rectangle of its cells, or anything else. */
type Reach = 'unit' | 'lines' | 'cells' | 'other';

type Removal = 'replace-in-slot' | 'remove-whole' | 'remove-lines' | 'delete';

const REMOVAL: Record<Family, Record<Reach, Removal>> = {
	structural: { unit: 'remove-whole', lines: 'remove-lines', cells: 'delete', other: 'delete' },
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

interface Removed {
	wrote: boolean;
	/** Where the removal left the caret, read on the committed tree. */
	caret: SelectionPoint | null;
}

function removeRange(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	removal: Exclude<Removal, 'replace-in-slot'>,
	insertion: RangeInsertion
): Promise<Removed> {
	const gesture = insertion.kind === 'none' ? insertion.gesture : 'keyless';
	const grid = coverage.grid;
	if (removal === 'remove-lines' && (grid?.kind === 'row' || grid?.kind === 'column')) {
		return commitGridLineDelete(ctx, grid).then((caret) => ({ wrote: caret !== null, caret }));
	}
	return commitRemoval(ctx, coverage, (body, sharing) =>
		removal === 'remove-whole'
			? removeHeldWhole(body, coverage, sharing, ctx.reading, gesture)
			: rangeDelete(body, coverage, sharing, ctx.reading, gesture)
	);
}

/** One commit over the document and every mounted container either endpoint splices. */
async function commitRemoval(
	ctx: CrossBlockMutationContext,
	coverage: RangeCoverage,
	remove: (body: Document, sharing: SharingState) => RangeDeleteResult
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
		landing: () => {
			const at = caret();
			return at && { path: docPathFrom(at.path), offset: at.offset };
		}
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

/** Typed text goes through the write every keystroke takes, so a marker typed at offset 0 makes
 *  the kind and the container's rule escapes what it must; a paste goes through the paste dispatch. */
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

/** Parks the caret where the removal left it, since the block reads it to run the command (a
 *  table's endpoint caret is a cell, which has the `runCommand`); false when no block took the key. */
async function runCommandAt(
	ctx: CrossBlockMutationContext,
	caret: SelectionPoint | null,
	path: number[],
	chord: string
): Promise<boolean> {
	if (caret) await ctx.caretLanding.park({ path: docPathFrom(caret.path), offset: caret.offset });
	const target = await ctx.caretLanding.mount(path);
	if (!target?.runCommand) return false;
	return dispatchKeyCommand(
		chord,
		{ kind: kindOfPath(path, ctx.getDoc()), runCommand: target.runCommand, getPath: () => path },
		ctx.commands
	);
}

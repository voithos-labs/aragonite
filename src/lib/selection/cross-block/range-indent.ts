/**
 * An indent key over a live range: every list item the range touches nests or lifts one level, the
 * code lines it covers indent or dedent, and nothing else changes. Each block answers through its
 * own key binding, so a kind that binds no indent command is left as it is. One undo entry per
 * press, and the range stays over the same text, so the key repeats.
 */

import type { CstNode, Document } from '../../core/nodes';
import { ownTrailingLineEnding } from '../../core/lines';
import type { CrossBlockDispatchContext } from './dispatch';
import { charOffsetOf, deleteSnapshot, type SelectionPoint } from '../primitives';
import { comparePaths } from '../path-math';
import { coverRange, rangeCoverage, type RangeCoverage } from '../range-coverage';
import { blockNodeAt, isBlockNode, nodeAt } from '../../tree-operations/node-primitives';
import { containerScopeState } from '../../tree-operations/paste/parent-scope';
import { nestListItem, liftNestedItem } from '../../tree-operations/list/item-moves';
import { shiftBodyLines } from '../../components/blocks/code/code-indent';
import { commandForKey } from '../../schema/commands';
import type { AnyCommandId } from '../../schema/command-id';
import { assertInvariant } from '../../assert';
import { isDevChecks } from '../../env';
import { checkIndentKeepsText, leafText } from '../../invariants/range-indent-keeps-text';

export type RangeIndentContext = Pick<
	CrossBlockDispatchContext,
	| 'selection'
	| 'getDoc'
	| 'controller'
	| 'reading'
	| 'caretLanding'
	| 'caretMemory'
	| 'commands'
	| 'pasteCoordinator'
>;

// ── Public API ─────────────────────────────────────────────────────────────

export async function indentRange(ctx: RangeIndentContext, e: KeyboardEvent): Promise<void> {
	const { anchor, focus, start } = ctx.selection;
	if (!ctx.selection.isCrossBlock || !anchor || !focus || !start) return;
	if (!ctx.controller.admitsGesture('rangeIndent')) return;
	ctx.caretMemory.forget();
	ctx.selection.resetSelectAllCount();

	const doc = ctx.getDoc();
	const coverage = rangeCoverage(doc, coverRange(doc, anchor, focus));
	const commandOf = (node: CstNode) => commandForKey(e, node.kind, ctx.commands);
	const plan = planIndent(doc, coverage, commandOf);
	if (plan.items.length === 0 && plan.code.length === 0) return;

	const tops = [coverage.range.start.path[0], coverage.range.end.path[0]] as const;
	const before = isDevChecks() ? leafText(doc, tops) : null;
	const unit = ctx.selection.wholeUnitPath;
	let shifted: Shifted = { ends: { anchor, focus }, wrote: false };
	// Seeded with the range, so one Ctrl+Z puts it back as it stood.
	await ctx.controller.undoStep(deleteSnapshot(start.path, start.offset), async () => {
		// The range is put back once, at the end, so no move's own caret is put down.
		await ctx.controller.holdLandings(async () => {
			const code = await shiftCode(ctx, plan.code, shifted.ends);
			const items = await moveItems(ctx, plan.items, code.ends, tops);
			shifted = { ends: items.ends, wrote: code.wrote || items.wrote };
		});
	});
	if (before) {
		assertInvariant('range-indent-keeps-text', () =>
			checkIndentKeepsText(before, leafText(ctx.getDoc(), tops))
		);
	}
	if (shifted.wrote) await restoreRange(ctx, shifted.ends, unit);
}

// ── The plan ───────────────────────────────────────────────────────────────

interface ItemShift {
	path: number[];
	command: 'list.indent' | 'list.unindent';
}

interface CodeShift {
	path: number[];
	from: number;
	to: number;
	direction: 'indent' | 'dedent';
}

interface IndentPlan {
	/** Every item the range reaches into, in document order. */
	items: ItemShift[];
	code: CodeShift[];
}

/** A leaf binding a code indent shifts its own covered lines; any other leaf belongs to the
 *  nearest container binding a list indent, the item whose own text it is. */
function planIndent(
	doc: Document,
	coverage: RangeCoverage,
	commandOf: (node: CstNode) => AnyCommandId | null
): IndentPlan {
	const plan: IndentPlan = { items: [], code: [] };
	const seen = new Set<string>();
	forEachCoveredLeaf(doc, coverage, (path, from, to) => {
		const leaf = blockNodeAt(doc, path);
		if (!leaf) return false;
		const own = commandOf(leaf);
		if (own === 'code.indent' || own === 'code.dedent') {
			plan.code.push({ path, from, to, direction: own === 'code.indent' ? 'indent' : 'dedent' });
			return false;
		}
		for (let depth = path.length - 1; depth > 0; depth--) {
			const holder = blockNodeAt(doc, path.slice(0, depth));
			const command = holder ? commandOf(holder) : null;
			if (!isItemMove(command)) continue;
			const key = path.slice(0, depth).join(',');
			if (!seen.has(key)) plan.items.push({ path: path.slice(0, depth), command });
			seen.add(key);
			return false;
		}
		return false;
	});
	plan.items.sort((a, b) => comparePaths(a.path, b.path));
	return plan;
}

/** Whether any block the range covers, a leaf or a block holding one, binds the key to one of the
 *  four indent commands; the plan above reads the same blocks the same way. */
export function coversIndentBinding(
	doc: Document,
	coverage: RangeCoverage,
	commandOf: (node: CstNode) => AnyCommandId | null
): boolean {
	let found = false;
	forEachCoveredLeaf(doc, coverage, (path) => {
		for (let depth = path.length; depth > 0 && !found; depth--) {
			const node = blockNodeAt(doc, path.slice(0, depth));
			found = node !== null && isIndentCommand(commandOf(node));
		}
		return found;
	});
	return found;
}

const isItemMove = (command: AnyCommandId | null): command is ItemShift['command'] =>
	command === 'list.indent' || command === 'list.unindent';

const isIndentCommand = (command: AnyCommandId | null): boolean =>
	isItemMove(command) || command === 'code.indent' || command === 'code.dedent';

/** Each leaf the range covers with the text offsets it covers, until `visit` answers true. A grid
 *  holds nothing to indent, so it visits none. */
function forEachCoveredLeaf(
	doc: Document,
	coverage: RangeCoverage,
	visit: (path: number[], from: number, to: number) => boolean
): void {
	if (coverage.grid) return;
	const { start, end } = coverage.range;
	if (coverage.startEdge && visit(start.path, textOffset(start), Infinity)) return;
	for (const root of coverage.wholeRoots) {
		for (const leaf of leavesUnder(doc, root)) if (visit(leaf, 0, Infinity)) return;
	}
	// An end at its block's first byte holds none of that block.
	const endAt = textOffset(end);
	if (coverage.endEdge && endAt !== 0) visit(end.path, 0, endAt);
}

/** A cell endpoint names no text offset, and no cell holds a line to shift. */
const textOffset = (point: SelectionPoint): number =>
	point.cellCoordinate ? Infinity : charOffsetOf(point, 'range-indent');

function leavesUnder(doc: Document, root: readonly number[]): number[][] {
	const leaves: number[][] = [];
	const walk = (node: CstNode, path: number[]) => {
		if (!node.children?.length) return void leaves.push(path);
		node.children.forEach((child, i) => walk(child, [...path, i]));
	};
	const node = blockNodeAt(doc, [...root]);
	if (node) walk(node, [...root]);
	return leaves;
}

// ── The writes ─────────────────────────────────────────────────────────────

/** Where the range's two ends sit, each tracked by the block it is in. */
interface Ends {
	anchor: SelectionPoint;
	focus: SelectionPoint;
}

interface Shifted {
	ends: Ends;
	wrote: boolean;
}

/** Code blocks first: their paths hold until an item moves, and a shifted line moves an end inside
 *  it by the tabs written before it. */
async function shiftCode(
	ctx: RangeIndentContext,
	shifts: CodeShift[],
	ends: Ends
): Promise<Shifted> {
	let { anchor, focus } = ends;
	let wrote = false;
	for (const shift of shifts) {
		const node = blockNodeAt(ctx.getDoc(), shift.path);
		if (!node) continue;
		const range = { start: shift.from, end: Math.min(shift.to, node.raw.length) };
		const result = shiftBodyLines(node, range, shift.direction);
		if (!result) continue;
		const written = await ctx.pasteCoordinator.commitLeafText(
			shift.path,
			result.text + ownTrailingLineEnding(node.raw),
			{ caret: result.selection.start, snapshotOffset: shift.from, landing: () => null }
		);
		if (!written.wrote) continue;
		wrote = true;
		const moved = (point: SelectionPoint): SelectionPoint => {
			if (comparePaths(point.path, shift.path) !== 0 || point.cellCoordinate) return point;
			const lead = point.offset <= range.start;
			return { ...point, offset: lead ? result.selection.start : result.selection.end };
		};
		anchor = moved(anchor);
		focus = moved(focus);
	}
	return { ends: { anchor, focus }, wrote };
}

/** Nesting runs top down, so an item lands under the one above as it now stands; lifting runs
 *  outermost first, then bottom up, so lifted siblings keep their order; a carried item moves once. */
async function moveItems(
	ctx: RangeIndentContext,
	shifts: ItemShift[],
	ends: Ends,
	tops: readonly [number, number]
): Promise<Shifted> {
	if (shifts.length === 0) return { ends, wrote: false };
	const doc = ctx.getDoc();
	// An item is found again by its first block, which a move carries along unwritten.
	const firstOf = (path: number[]) => blockNodeAt(doc, path)?.children?.[0] ?? null;
	const order = shifts.map((s) => ({ ...s, first: firstOf(s.path) }));
	if (shifts[0].command === 'list.unindent') {
		order.sort((a, b) => a.path.length - b.path.length || comparePaths(b.path, a.path));
	}
	const endNodes = { anchor: nodeAt(doc, ends.anchor.path), focus: nodeAt(doc, ends.focus.path) };

	const moved = new Set<unknown>();
	for (const shift of order) {
		if (!shift.first) continue;
		const paths = pathsOf(ctx.getDoc(), tops);
		const firstPath = paths.get(shift.first);
		if (!firstPath) continue;
		const itemPath = firstPath.slice(0, -1);
		if (carriedBy(ctx.getDoc(), itemPath, moved)) continue;
		const ok =
			shift.command === 'list.indent'
				? await nestItem(ctx, itemPath)
				: await liftItem(ctx, itemPath);
		if (ok) moved.add(shift.first);
	}
	if (moved.size === 0) return { ends, wrote: false };

	const paths = pathsOf(ctx.getDoc(), tops);
	const follow = (point: SelectionPoint, node: unknown): SelectionPoint => {
		const path = paths.get(node);
		return path ? { ...point, path } : point;
	};
	return {
		ends: {
			anchor: follow(ends.anchor, endNodes.anchor),
			focus: follow(ends.focus, endNodes.focus)
		},
		wrote: true
	};
}

function nestItem(ctx: RangeIndentContext, itemPath: number[]): Promise<boolean> {
	const listPath = itemPath.slice(0, -1);
	const list = blockNodeAt(ctx.getDoc(), listPath);
	if (!list) return Promise.resolve(false);
	const target = {
		node: list,
		state: containerScopeState(ctx.pasteCoordinator, list),
		path: listPath
	};
	return nestListItem(ctx.pasteCoordinator, target, itemPath[itemPath.length - 1]);
}

/** Lifts the item out of the sublist its parent item holds; a list with no item above it, or one
 *  inside another container, has nowhere to lift to. */
function liftItem(ctx: RangeIndentContext, itemPath: number[]): Promise<boolean> {
	const doc = ctx.getDoc();
	const nestedPath = itemPath.slice(0, -1);
	const outerPath = nestedPath.slice(0, -2);
	const nested = blockNodeAt(doc, nestedPath);
	const outer = outerPath.length > 0 ? blockNodeAt(doc, outerPath) : null;
	if (!nested || !outer) return Promise.resolve(false);
	const target = {
		node: outer,
		state: containerScopeState(ctx.pasteCoordinator, outer),
		path: outerPath
	};
	return liftNestedItem(
		ctx.pasteCoordinator,
		target,
		nestedPath[nestedPath.length - 2],
		nested,
		itemPath[itemPath.length - 1],
		ctx.reading.grammar
	);
}

/** Whether an item holding `itemPath` already moved this press, taking this one with it. */
function carriedBy(doc: Document, itemPath: number[], moved: Set<unknown>): boolean {
	for (let depth = itemPath.length - 1; depth > 0; depth--) {
		const first = blockNodeAt(doc, itemPath.slice(0, depth))?.children?.[0];
		if (first && moved.has(first)) return true;
	}
	return false;
}

/** Every node under the top-level blocks the range spans, by identity; a move never changes a
 *  top-level index. */
function pathsOf(doc: Document, tops: readonly [number, number]): Map<unknown, number[]> {
	const paths = new Map<unknown, number[]>();
	const walk = (node: CstNode, path: number[]) => {
		paths.set(node, path);
		node.children?.forEach((child, i) => walk(child, [...path, i]));
	};
	for (let i = tops[0]; i <= tops[1]; i++) {
		const top = doc.children[i];
		if (top && isBlockNode(top)) walk(top, [i]);
	}
	return paths;
}

/** A range held whole as one unit is put back whole, since a same-path pair is no range. */
async function restoreRange(
	ctx: RangeIndentContext,
	ends: Ends,
	unit: number[] | null
): Promise<void> {
	if (unit && comparePaths(ends.anchor.path, ends.focus.path) === 0) {
		const path = ends.anchor.path;
		ctx.selection.enterCrossBlock({ path, wholeBlock: true }, { path, wholeBlock: true });
		return;
	}
	await ctx.caretLanding.restore({ anchor: ends.anchor, focus: ends.focus });
}

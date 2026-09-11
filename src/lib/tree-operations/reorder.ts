import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
import { absorbWindowSeams, type SettledSplice } from './settle';
import type { StructuralChange } from './structural-change';
import { devWarn } from '../dev-warn';

// A stale index (a mid-drag delete shrank the array) would splice `undefined` into the
// $state tree, so both entry points bail through this BEFORE any unshare or write.
function isReorderOutOfBounds(from: number, to: number, len: number): boolean {
	if (from < 0 || from >= len || to < 0 || to >= len) {
		devWarn('reorder', `reorder out of bounds: from=${from} to=${to} len=${len}`);
		return true;
	}
	return false;
}

// A reorder rewrites no bytes and creates no node: it is one contiguous `replace`
// whose idMap permutes the spanned window so each moved block keeps its id + ref.
export function reorderChildren(children: CstNode[], from: number, to: number): StructuralChange {
	if (from === to) return { op: 'noop' };
	if (isReorderOutOfBounds(from, to, children.length)) return { op: 'noop' };
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	const count = hi - lo + 1;
	const oldWindow = Array.from({ length: count }, (_, k) => lo + k);
	const [movedOld] = oldWindow.splice(from - lo, 1);
	oldWindow.splice(to - lo, 0, movedOld);
	const [node] = children.splice(from, 1);
	children.splice(to, 0, node);
	const idMap: Record<number, number> = {};
	for (let k = 0; k < count; k++) idMap[k] = oldWindow[k] - lo;
	return { op: 'replace', at: lo, count, newCount: count, idMap };
}

/**
 * Reorder children while keeping block separators positional. A separator is stored as the next
 * child's `leadingTrivia` but read per slot, so it belongs to the position, not the node. Writing
 * it is a byte write, so spanned children are unshared first (`unshare.ts`) and `children` must
 * already be an owned array. The landing rides the result: a fold settling a seam the move
 * invalidated can sit above the moved block.
 */
export function reorderChildrenWithTrivia(
	children: CstNode[],
	from: number,
	to: number,
	sharing: SharingState,
	/** Top-level blocks only: a blank line is a document separator, not a list's or a quote's,
	 *  whose own children carry their marker and would read a bare blank line as an end. */
	separators = false
): SettledSplice {
	if (from === to) return { change: { op: 'noop' }, landing: to };
	if (isReorderOutOfBounds(from, to, children.length)) {
		return { change: { op: 'noop' }, landing: from };
	}
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	const windowTrivia: string[] = [];
	for (let i = lo; i <= hi; i++) {
		windowTrivia.push(ensureUnsharedChild({ children }, i, sharing).leadingTrivia);
	}
	const moved = children[from];
	const change = reorderChildren(children, from, to);
	for (let k = 0; k < windowTrivia.length; k++) {
		children[lo + k].leadingTrivia = windowTrivia[k];
	}
	// The rotation reseats every slot in the window, and a block can land flush under a
	// paragraph that then reads its lines as its own — a table dissolving into the prose above
	// it. The seam it VACATED is the exception: a pair rejoining once the block between them
	// leaves is the reload's own reading, which the absorber below settles.
	const vacated = from < to ? from : from + 1;
	const seams: number[] = [];
	if (separators) {
		for (let i = lo; i <= hi + 1; i++) if (i !== vacated) seams.push(i);
	}
	// Identity read BEFORE the inserts shift every index below them.
	const oldOf = windowIdentity(change, children, lo);
	const inserted = separateSeams(children, seams);
	const settledChange =
		inserted === 0 ? change : widenForInserts(change, children, lo, inserted, oldOf);
	const added = hi - lo + 1 + inserted;
	return absorbWindowSeams(
		{ children },
		lo,
		added,
		children.indexOf(moved),
		settledChange,
		sharing
	);
}

/** Descending, so an insertion never shifts a seam still to be judged. */
function separateSeams(children: CstNode[], seams: number[]): number {
	let inserted = 0;
	for (const at of [...new Set(seams)].sort((a, b) => b - a)) {
		if (at <= 0 || at >= children.length) continue;
		if (!needsSeparator(children[at - 1], children[at])) continue;
		children.splice(at, 0, { kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		inserted++;
	}
	return inserted;
}

/**
 * Whether this seam swallows for want of a SEPARATOR — the only fusion a reorder should undo.
 * A block that swallows across a blank line does so on its own account (an unterminated fence
 * takes the prose below it whatever sits between), and that fold is the reload's true reading:
 * leave it to the absorber, which is what the fold tests pin.
 */
function needsSeparator(prev: CstNode, next: CstNode): boolean {
	return (
		readsAsOne(prev.raw + next.leadingTrivia + next.raw) && !readsAsOne(seamWithBlank(prev, next))
	);
}

function seamWithBlank(prev: CstNode, next: CstNode): string {
	const trivia = next.leadingTrivia.startsWith('\n')
		? next.leadingTrivia
		: `\n${next.leadingTrivia}`;
	return `${prev.raw}\n${trivia}${next.raw}`;
}

function readsAsOne(bytes: string): boolean {
	return parse(bytes, { scope: 'fragment' }).children.length < 2;
}

/** Which node currently holds each of the permutation's old slots. */
function windowIdentity(
	change: StructuralChange,
	children: CstNode[],
	lo: number
): Map<CstNode, number> {
	const oldOf = new Map<CstNode, number>();
	if (change.op !== 'replace') return oldOf;
	for (const [k, old] of Object.entries(change.idMap ?? {})) {
		const node = children[lo + Number(k)];
		if (node) oldOf.set(node, old);
	}
	return oldOf;
}

/**
 * The window grew by nodes the permutation did not have: re-derive new-index → old-index from
 * node identity, so every block that WAS in the window keeps its id and the separators take
 * fresh ones.
 */
function widenForInserts(
	change: StructuralChange,
	children: CstNode[],
	lo: number,
	inserted: number,
	oldOf: Map<CstNode, number>
): StructuralChange {
	if (change.op !== 'replace') return change;
	const newCount = change.newCount + inserted;
	const idMap: Record<number, number> = {};
	children.slice(lo, lo + newCount).forEach((node, i) => {
		const old = oldOf.get(node);
		if (old !== undefined) idMap[i] = old;
	});
	return { ...change, newCount, idMap };
}

import type { CstNode } from '../core/nodes';
import { isBlankParagraph, parse } from '../core/parser';
import { trailingLineEnding } from '../core/lines';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
import { absorbWindowSeams, settleSeparatorOnBlank, type SettledSplice } from './settle';
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
	const change = reorderChildren(children, from, to);
	for (let k = 0; k < windowTrivia.length; k++) {
		children[lo + k].leadingTrivia = windowTrivia[k];
	}
	if (separators) {
		// The rotation reseats every slot in the window, and a block can land flush under a
		// paragraph that then reads its lines as its own (a table dissolving into the prose above
		// it). The seam it VACATED is the exception: a pair rejoining once the block between them
		// leaves is the reload's own reading, which the absorber below settles.
		const vacated = from < to ? from : from + 1;
		for (let at = lo; at <= hi + 1; at++) {
			if (at !== vacated) separateSeam(children, at, sharing);
		}
		// A blank line reseated by position can hold a line its follower holds too; the run owes
		// exactly one, and none at the document head, where the reload reads each as a block.
		for (let at = lo; at <= hi; at++) {
			if (isBlankParagraph(children[at])) settleSeparatorOnBlank({ children }, at, sharing);
		}
	}
	return absorbWindowSeams({ children }, lo, hi - lo + 1, to, change, sharing);
}

/**
 * Give the follower at `at` a separator where the reload would otherwise not read the two
 * blocks back as themselves, and only then: a block that swallows across a blank line (an
 * unterminated fence taking the prose below it) is the reload's true reading, left to the
 * absorber, which the fold tests pin.
 */
function separateSeam(children: CstNode[], at: number, sharing: SharingState): void {
	if (at <= 0 || at >= children.length) return;
	const prev = children[at - 1];
	const next = children[at];
	const apart = withLeadingLine(next.leadingTrivia, trailingLineEnding(next.raw));
	if (apart === next.leadingTrivia) return;
	if (readsAsBoth(prev, next.leadingTrivia, next) || !readsAsBoth(prev, apart, next)) return;
	ensureUnsharedChild({ children }, at, sharing).leadingTrivia = apart;
}

function withLeadingLine(trivia: string, eol: string): string {
	return trivia.startsWith('\n') || trivia.startsWith('\r\n') ? trivia : eol + trivia;
}

// Two blocks of the same shape, not merely two: a quote lazily taking the first line of the
// prose below it still reads as two, with the remainder a different kind.
function readsAsBoth(prev: CstNode, trivia: string, next: CstNode): boolean {
	const blocks = parse(prev.raw + trivia + next.raw, { scope: 'fragment' }).children;
	return (
		blocks.length === 2 &&
		blocks[0].kind === prev.kind &&
		blocks[0].raw === prev.raw &&
		blocks[1].kind === next.kind &&
		blocks[1].raw === next.raw
	);
}

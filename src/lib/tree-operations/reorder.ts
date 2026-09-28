import type { CstNode } from '../core/nodes';
import { isBlankParagraph, readBlocks } from '../core/parser';
import { lineEndingAt, ownTrailingLineEnding } from '../core/lines';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
import { endWindowLines } from './open-tail';
import type { BodyParent } from './node-primitives';
import { absorbWindowSeams, settleSeparatorOnBlank, type SettledSplice } from './settle';
import type { StructuralChange } from './structural-change';
import { devWarn } from '../dev-warn';
import type { GrammarView } from '../schema/block-openers';

// A stale index (a mid-drag delete shrank the array) would splice `undefined` into the
// $state tree, so both entry points check the bounds before any copy or write.
function isReorderOutOfBounds(from: number, to: number, len: number): boolean {
	if (from < 0 || from >= len || to < 0 || to >= len) {
		devWarn('reorder', `reorder out of bounds: from=${from} to=${to} len=${len}`);
		return true;
	}
	return false;
}

// A reorder rewrites no bytes and creates no node: it is one contiguous `replace`
// whose idMap permutes the spanned window so each moved block keeps its id and ref.
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
 * Reorder a body's children, each separator staying with its position rather than its node. The
 * children must be an owned array; the result's `landing` counts any merge the move set off.
 */
export function reorderChildrenWithTrivia(
	body: BodyParent,
	from: number,
	to: number,
	sharing: SharingState,
	/** The editor's grammar, in which the checks below reread each pair of moved blocks. */
	grammar: GrammarView
): SettledSplice {
	const children = body.children;
	if (from === to) return { change: { op: 'noop' }, landing: to };
	if (isReorderOutOfBounds(from, to, children.length)) {
		return { change: { op: 'noop' }, landing: from };
	}
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	// Whether the moved block sat flush against both its neighbours, read before the rotation.
	const flushAround = !children[from].leadingTrivia && !children[from + 1]?.leadingTrivia;
	const windowTrivia: string[] = [];
	for (let i = lo; i <= hi; i++) {
		windowTrivia.push(ensureUnsharedChild({ children }, i, sharing).leadingTrivia);
	}
	const change = reorderChildren(children, from, to);
	for (let k = 0; k < windowTrivia.length; k++) {
		children[lo + k].leadingTrivia = windowTrivia[k];
	}
	// The joins below read the moved blocks side by side, so a moved open last line ends first; the
	// commit gives the ending back to whichever block is last.
	endWindowLines(body, change, sharing);
	// Each join the move touches gets a blank line where the two blocks would read as one; the
	// pair the moved block left rejoins only if it sat flush against both of them.
	const vacated = from < to ? from : from + 1;
	for (let at = lo; at <= hi + 1; at++) {
		if (at !== vacated || !flushAround) separateSeam(children, at, sharing, grammar);
	}
	// A blank block moved by position can hold a line its follower holds too; the run needs
	// exactly one, and none at the document head, where the reload reads each as a block.
	for (let at = lo; at <= hi; at++) {
		if (isBlankParagraph(children[at])) settleSeparatorOnBlank({ children }, at, sharing);
	}
	return absorbWindowSeams({ children }, lo, hi - lo + 1, to, change, grammar, sharing);
}

/**
 * Give the follower at `at` a separator only where the reload would not read the two blocks back
 * as themselves; a block that swallows across a blank line is left to the neighbour merge.
 */
function separateSeam(
	children: CstNode[],
	at: number,
	sharing: SharingState,
	grammar: GrammarView
): void {
	if (at <= 0 || at >= children.length) return;
	const prev = children[at - 1];
	const next = children[at];
	// The block above is not the last, so its line ending is the document's.
	const apart = withLeadingLine(next.leadingTrivia, ownTrailingLineEnding(prev.raw));
	if (apart === next.leadingTrivia) return;
	const readsAsBoth = (trivia: string) => readsAsPair(prev, trivia, next, grammar);
	if (readsAsBoth(next.leadingTrivia) || !readsAsBoth(apart)) return;
	ensureUnsharedChild({ children }, at, sharing).leadingTrivia = apart;
}

function withLeadingLine(trivia: string, eol: string): string {
	return lineEndingAt(trivia, 0) !== '' ? trivia : eol + trivia;
}

// Two blocks of the same shape, not merely two: a quote lazily taking the first line of the
// prose below it still reads as two, with the remainder a different kind.
function readsAsPair(prev: CstNode, trivia: string, next: CstNode, grammar: GrammarView): boolean {
	const blocks = readBlocks(prev.raw + trivia + next.raw, { grammar, scope: 'fragment' }).children;
	return (
		blocks.length === 2 &&
		blocks[0].kind === prev.kind &&
		blocks[0].raw === prev.raw &&
		blocks[1].kind === next.kind &&
		blocks[1].raw === next.raw
	);
}

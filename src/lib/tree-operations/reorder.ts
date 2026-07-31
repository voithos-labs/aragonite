import type { CstNode } from '../core/nodes';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
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
 * Reorder children while keeping block separators positional. A separator is stored as
 * the next child's `leadingTrivia` but read per slot, so it belongs to the position, not
 * the node; permuting nodes alone would drag each separator along. Writing
 * `leadingTrivia` is a byte write, so spanned children are unshared first (`unshare.ts`)
 * and `children` must already be an owned array.
 */
export function reorderChildrenWithTrivia(
	children: CstNode[],
	from: number,
	to: number,
	sharing: SharingState
): StructuralChange {
	if (from === to) return { op: 'noop' };
	if (isReorderOutOfBounds(from, to, children.length)) return { op: 'noop' };
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
	return change;
}

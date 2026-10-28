import type { CstNode } from '../core/nodes';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
import type { BodyParent } from './node-primitives';
import type { GrammarView } from '../schema/block-openers';
import { closeWrittenOpeners } from './content-write';
import type { StructuralChange } from './structural-change';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';

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

/** A move before the commit's fix-up: its change, where the moved block stands, and the join the
 *  move uncovered, when it took a block from flush between two. */
export interface Reordered {
	change: StructuralChange;
	landing: number;
	uncovered: number | null;
}

/** Reorder an owned children array, each separator staying with its position and the moved block
 *  closed where it lands; the commit's fix-up, told the move and the join it uncovered, settles it. */
export function reorderChildrenWithTrivia(
	body: BodyParent,
	from: number,
	to: number,
	sharing: SharingState,
	grammar: GrammarView
): Reordered {
	const children = body.children;
	if (from === to) return { change: { op: 'noop' }, landing: to, uncovered: null };
	if (isReorderOutOfBounds(from, to, children.length)) {
		return { change: { op: 'noop' }, landing: from, uncovered: null };
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
	// A moved opener reads down into its new neighbours unless it gets its own closer there; every
	// line of it is new where it lands.
	const [placed] = closeWrittenOpeners(body, to, '', [children[to]], grammar);
	if (placed !== children[to]) {
		sharing.stamp(placed);
		children[to] = placed;
	}
	// The pair the moved block left meets here, uncovered only when it sat flush between them.
	const vacated = from < to ? from : from + 1;
	return { change, landing: to, uncovered: flushAround ? vacated : null };
}

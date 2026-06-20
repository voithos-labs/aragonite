import type { CstNode } from '../core/nodes';
import type { StructuralChange } from './structural-change';

// A reorder rewrites no bytes and creates no node: it is one contiguous `replace`
// whose idMap permutes the spanned window so each moved block keeps its id + ref.
export function reorderChildren(children: CstNode[], from: number, to: number): StructuralChange {
	if (from === to) return { op: 'noop' };
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

import type { CstNode } from '../core/nodes';
import { blockFacts } from '../schema/block-facts';
import type { StructuralChange } from '../tree-operations/structural-change';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

/** G1.36, the writing half: a descriptor's range fits the array it keeps in step and never asks
 *  for a negative count, which `Array.from({length: -1})` would silently turn into `[]`. */
export function checkStructuralDescriptor(
	change: StructuralChange,
	length: number
): InvariantViolation | null {
	if (change.op === 'noop') return null;
	const newCount =
		change.op === 'replace' ? change.newCount : change.op === 'insert' ? change.count : 0;
	const removed = change.op === 'insert' ? 0 : change.count;
	if (change.at >= 0 && removed >= 0 && newCount >= 0 && change.at + removed <= length) return null;
	return {
		code: 'structural-descriptor-bounds',
		message: `structural change ${change.op} at ${change.at} (removes ${removed}, adds ${newCount}) does not fit ${length} slots`,
		detail: { change, length }
	};
}

/** G1.154: a content write's fixed-up change, when it replaces a window, holds the written block
 *  at `index`, since the caret is placed by reading that window's blocks. */
export function checkWriteInWindow(
	change: StructuralChange,
	index: number
): InvariantViolation | null {
	if (change.op !== 'replace' || (index >= change.at && index < change.at + change.count))
		return null;
	return {
		code: 'write-in-window',
		message: `a write at ${index} fixed up to a window at ${change.at} of ${change.count} that misses it`,
		detail: { change, index }
	};
}

/** G1.36, the reading half: one id per child once a commit has written its state, which catches
 *  a descriptor that fits its own array but describes the wrong range. */
export function checkIdsChildrenLockstep(
	seam: string,
	idCount: number,
	childCount: number
): InvariantViolation | null {
	if (idCount === childCount) return null;
	return {
		code: 'ids-children-lockstep',
		message: `${seam}: ${idCount} ids for ${childCount} children`,
		detail: { seam, idCount, childCount }
	};
}

/** G1.36 over the child spans: one pair of span bounds per child once a rebuild has run, and a
 *  list's where its joined items sit, or a byte lookup reads a stale start. */
export function checkChildSpansLockstep(node: CstNode): InvariantViolation | null {
	const spans = node.childSpans;
	if (!spans) return null;
	const childCount = node.children?.length ?? 0;
	if (spans.length === childCount * 2) {
		const stale = blockFacts(node.kind).lines === 'items' ? staleItemSpan(node, spans) : -1;
		if (stale < 0) return null;
		return {
			code: 'child-spans-lockstep',
			message: `${node.kind}: item ${stale}'s span bounds don't sit where its bytes do`,
			detail: { kind: node.kind, item: stale }
		};
	}
	return {
		code: 'child-spans-lockstep',
		message: `${node.kind}: ${spans.length} span bounds for ${childCount} children`,
		detail: { kind: node.kind, spanCount: spans.length, childCount }
	};
}

/** The first item whose span bounds aren't where the list's joined bytes put it; -1 for none. */
function staleItemSpan(node: CstNode, spans: Uint32Array): number {
	const children = node.children ?? [];
	let at = 0;
	for (let i = 0; i < children.length; i++) {
		const end = at + children[i].leadingTrivia.length + children[i].raw.length;
		if (spans[i * 2] !== at || spans[i * 2 + 1] !== end) return i;
		at = end;
	}
	return -1;
}

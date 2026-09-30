import type { CstNode } from '../core/nodes';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { InvariantViolation } from '../assert';

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

/** G1.36 over the child spans: one pair of span bounds per child once a rebuild has run, or the
 *  next keystroke splices a stale region. */
export function checkChildSpansLockstep(node: CstNode): InvariantViolation | null {
	const spans = node.childSpans;
	if (!spans) return null;
	const childCount = node.children?.length ?? 0;
	if (spans.length === childCount * 2) return null;
	return {
		code: 'child-spans-lockstep',
		message: `${node.kind}: ${spans.length} span bounds for ${childCount} children`,
		detail: { kind: node.kind, spanCount: spans.length, childCount }
	};
}

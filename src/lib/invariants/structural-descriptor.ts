import type { CstNode } from '../core/nodes';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { InvariantViolation } from '../assert';

/**
 * G1.36, producer half — a descriptor's window fits the array it syncs and mints no negative
 * slot count. `Array.from({length: -1})` is `[]`, so a descriptor derived from a length diff
 * over the wrong window desyncs ids from children in silence.
 */
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

/**
 * G1.36, consumer half — one id per child once a commit publishes. The producer check cannot
 * see a descriptor that fits its own array while describing the wrong window, which is what
 * a length-diff derivation over a settle-folded splice produces.
 */
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

/**
 * G1.36 over the other parallel array — one span PAIR per child once a rebuild has run
 * (`schema/child-spans.ts`). A rebuilder seeding the wrong length, or a shape change that
 * outlived its drop, is a stale-region splice waiting for the next keystroke.
 */
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

import type { CstNode } from '../core/nodes';
import { displayLength } from '../core/lines';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { getContentRange, type ContentRange } from '../core/inline';
import type { InvariantViolation } from './assert';

/**
 * G1.8 — a prose kind's content range stays within its raw:
 * `0 <= start <= end <= displayLength(raw)`. `getRange` is a parameter so a negative test
 * can inject an out-of-bounds range without touching the descriptor registry.
 */
export function checkContentRange(
	node: CstNode,
	getRange: (node: CstNode) => ContentRange = getContentRange
): InvariantViolation | null {
	if (!getBlockKindDescriptor(node.kind).supportsInline) return null;

	const { start, end } = getRange(node);
	const len = displayLength(node.raw);
	if (!(0 <= start && start <= end && end <= len)) {
		return {
			code: 'content-range-out-of-bounds',
			message: `content range [${start}, ${end}] out of bounds for "${node.kind}" (len ${len})`,
			detail: { kind: node.kind, start, end, len }
		};
	}
	return null;
}

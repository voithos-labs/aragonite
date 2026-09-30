import type { CstNode } from '../core/nodes';
import { displayLength } from '../core/lines';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { getContentRange, type ContentRange } from '../core/inline';
import type { InvariantViolation } from '../assert';

/** G1.8: a content range stays inside its raw bytes, for every kind that declares one, since
 *  callers use the range unchecked. `getRange` is a parameter so a test can inject a bad range. */
export function checkContentRange(
	node: CstNode,
	getRange: (node: CstNode) => ContentRange = getContentRange
): InvariantViolation | null {
	const descriptor = getBlockKindDescriptor(node.kind);
	if (!descriptor.supportsInline && descriptor.getContentRange === undefined) return null;

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

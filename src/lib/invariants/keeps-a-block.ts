/**
 * G1.44: after a structural commit the document holds a block, and no container the commit
 * touched that must hold a child is left with none.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import type { InvariantViolation } from '../assert';
import { mustHoldChild } from '../schema/block-kind-descriptor';

export function checkKeepsABlock(
	doc: DocumentView,
	touched: readonly NodeView[]
): InvariantViolation | null {
	if (doc.children.length === 0) return violation('the document holds no block');
	const emptied = touched.find((n) => mustHoldChild(n.kind) && (n.children?.length ?? 0) === 0);
	return emptied ? violation(`a ${emptied.kind} holds no block`) : null;
}

function violation(message: string): InvariantViolation {
	return { code: 'keeps-a-block', message };
}

/**
 * G1.41: after a structural commit only the document's last line may lack a line ending, and it
 * lacks one exactly when it did before the commit, unless it is blank.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { ownTrailingLineEnding } from '../core/lines';
import { holdsBlankLastLine } from '../tree-operations/open-tail';
import type { InvariantViolation } from '../assert';
import { childHoldingLastLine } from '../schema/container-raw';
import {
	getBlockKindDescriptor,
	isGridDescriptor,
	isGridKind
} from '../schema/block-kind-descriptor';

export function checkLastLineKept(doc: DocumentView, wasOpen: boolean): InvariantViolation | null {
	const last = doc.children.at(-1);
	if (!last) return null;
	const open = doc.suffix === '' && ownTrailingLineEnding(last.raw) === '';
	const blank = doc.suffix !== '' || holdsBlankLastLine(last);
	if (wasOpen && !open && !blank) {
		return violation('the document had no final line break and gained one on a written line');
	}
	if (!wasOpen && open) return violation('the document ended in a line break and lost it');
	const glued = unendedAboveLastLine(doc.children, doc.children.length - 1, 'document');
	return glued ? violation(`${glued} ends with no line break above the last line`) : null;
}

function violation(message: string): InvariantViolation {
	return { code: 'last-line-kept', message };
}

/** Down the last line's path, the first line with no ending right above the line holding the
 *  last one, which is the parent's own line when `holder` is -1: the two read as one. */
function unendedAboveLastLine(
	lines: readonly NodeView[],
	holder: number,
	trail: string
): string | null {
	const below = holder < 0 ? lines.length : holder;
	for (let i = below - 1; i >= Math.max(0, below - 2); i--) {
		if (ownTrailingLineEnding(lines[i].raw) === '') return `${trail} > ${lines[i].kind}`;
	}
	if (holder < 0) return null;
	const node = lines[holder];
	const next = childHoldingLastLine(node);
	return unendedAboveLastLine(lineChildren(node, next), next, `${trail} > ${node.kind}`);
}

/** A container's children that are lines of its body: a strip's children and a grid's rows. */
function lineChildren(node: NodeView, holder: number): readonly NodeView[] {
	const children = node.children ?? [];
	if (holder >= 0 || children.length === 0) return children;
	const descriptor = getBlockKindDescriptor(node.kind);
	if (descriptor.containerContract === 'strip') return children;
	return isGridDescriptor(descriptor) && isGridKind(children.at(-1)!.kind) ? children : [];
}

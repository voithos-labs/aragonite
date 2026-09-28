/**
 * G1.41: after a structural commit only the document's last line may lack a line ending, and it
 * lacks one exactly when it did before the commit, unless it is blank.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { endsInBlankLine, ownTrailingLineEnding } from '../core/lines';
import type { InvariantViolation } from '../assert';
import { getBlockKindDescriptor, isGridKind } from '../schema/block-kind-descriptor';

export function checkLastLineKept(doc: DocumentView, wasOpen: boolean): InvariantViolation | null {
	const last = doc.children.at(-1);
	if (!last) return null;
	const open = doc.suffix === '' && ownTrailingLineEnding(last.raw) === '';
	const blank = doc.suffix !== '' || endsInBlankLine(last.raw);
	if (wasOpen && !open && !blank) {
		return violation('the document had no final line break and gained one on a written line');
	}
	if (!wasOpen && open) return violation('the document ended in a line break and lost it');
	const glued = unendedAboveLastLine(doc.children, 'document');
	return glued ? violation(`${glued} ends with no line break above the last line`) : null;
}

function violation(message: string): InvariantViolation {
	return { code: 'last-line-kept', message };
}

/** The first node on the last line's path, from the top down, whose sibling above it lacks an
 *  ending: those two lines read as one. */
function unendedAboveLastLine(children: readonly NodeView[], trail: string): string | null {
	const last = children.at(-1);
	if (!last) return null;
	const above = children.at(-2);
	if (above && ownTrailingLineEnding(above.raw) === '') return `${trail} > ${above.kind}`;
	const next = holdsLastLineInChildren(last) ? last.children : undefined;
	return next ? unendedAboveLastLine(next, `${trail} > ${last.kind}`) : null;
}

/** The last line runs through a strip container's last child and a grid's last row; an opaque
 *  body and a row's cells sit inside the container's own lines. */
function holdsLastLineInChildren(node: NodeView): boolean {
	if (!node.children?.length) return false;
	const contract = getBlockKindDescriptor(node.kind).containerContract;
	return contract === 'strip' || (contract === 'grid' && isGridKind(node.children.at(-1)!.kind));
}

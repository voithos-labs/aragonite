/**
 * G1.41: after a structural commit only the document's last line may lack a line ending, and it
 * lacks one exactly when it did before the commit, unless it is blank.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { ownTrailingLineEnding } from '../core/lines';
import { holdsBlankLastLine } from '../tree-operations/open-tail';
import type { InvariantViolation } from '../assert';
import { childHoldingLastLine } from '../schema/container-raw';

export function checkLastLineKept(doc: DocumentView, wasOpen: boolean): InvariantViolation | null {
	const last = doc.children.at(-1);
	if (!last) return null;
	const open = doc.suffix === '' && ownTrailingLineEnding(last.raw) === '';
	const blank = doc.suffix !== '' || holdsBlankLastLine(last);
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
	return childHoldingLastLine(last) < 0
		? null
		: unendedAboveLastLine(last.children!, `${trail} > ${last.kind}`);
}

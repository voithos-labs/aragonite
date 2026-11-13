/**
 * G1.41: after a structural commit only the document's last line may lack a line ending, and it
 * lacks one exactly when it did before the commit, unless it is blank. An empty document has no
 * last line, so a write into one keeps nothing. Read off the bytes, never off the fix-up that
 * wrote them.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { endsInBlankLine, ownTrailingLineEnding } from '../core/lines';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { childHoldingLastLine, lineChildren } from '../schema/container-raw';

/** How a document's bytes end: on a line with no ending, on a line ending, or on no line at all. */
export type LastLine = 'open' | 'closed' | 'none';

/** `before` is {@link lastLineOf} read before the commit mutated. */
export function checkLastLineKept(doc: DocumentView, before: LastLine): InvariantViolation | null {
	const last = doc.children.at(-1);
	if (!last) return null;
	const open = lastLineOf(doc) === 'open';
	const blank = doc.suffix !== '' || holdsBlankLastLine(last);
	if (before === 'open' && !open && !blank) {
		return violation('the document had no final line break and gained one on a written line');
	}
	if (before === 'closed' && open)
		return violation('the document ended in a line break and lost it');
	const glued = unendedAboveLastLine(doc.children, doc.children.length - 1, 'document');
	return glued ? violation(`${glued} ends with no line break above the last line`) : null;
}

/** The document's last line, read from the end of its bytes. */
export function lastLineOf(doc: DocumentView): LastLine {
	let tail = doc.suffix;
	for (let i = doc.children.length - 1; tail === '' && i >= 0; i--) {
		tail = doc.children[i].raw || (doc.children[i].leadingTrivia ?? '');
	}
	if (tail === '') return 'none';
	return ownTrailingLineEnding(tail) === '' ? 'open' : 'closed';
}

/** Whether the line `node` ends on is blank, down the children holding it; a quote's own trailing
 *  `>` line has a marker, so it is not. */
export function holdsBlankLastLine(node: NodeView): boolean {
	const holder = childHoldingLastLine(node);
	return holder < 0 ? endsInBlankLine(node.raw) : holdsBlankLastLine(node.children![holder]);
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
	// A holder indexes the children; the container's own last line follows only its line children.
	const nextLines = next >= 0 ? node.children! : lineChildren(node);
	return unendedAboveLastLine(nextLines, next, `${trail} > ${node.kind}`);
}

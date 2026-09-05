/**
 * The blank line a list whose first item is EMPTY owes the paragraph directly above it. A
 * content-less marker cannot interrupt a paragraph (CommonMark § 5.2), so those bytes reload as
 * a setext heading, and the marker is the item's only evidence, so the seam absorb has nothing
 * to fold it into. A content-bearing list that stopped interrupting is the absorb's case.
 */

import type { CstNode } from '../../core/nodes';
import { trailingLineEnding } from '../../core/lines';

/**
 * A marker line carrying nothing after it: the Enter+Tab mint, and an emptied nested item. The
 * trailing run is required, matching `matchListItem` — a bare `-` never opened a list at all.
 */
const EMPTY_MARKER_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+$/;

/**
 * Give the child at `index` its separating line when it is a list no reload could read back.
 * Idempotent, and a no-op for every child that already stands apart, so a nesting splice or a
 * raw rebuild may call it unconditionally.
 */
export function settleSublistSeparator(children: CstNode[], index: number): void {
	const list = children[index];
	const above = children[index - 1];
	if (!list || list.kind !== 'list' || list.leadingTrivia !== '') return;
	if (!above || above.kind !== 'paragraph' || above.raw.trim() === '') return;
	if (!EMPTY_MARKER_LINE.test(firstLineOf(list.raw))) return;
	list.leadingTrivia = trailingLineEnding(above.raw);
}

function firstLineOf(raw: string): string {
	const nl = raw.indexOf('\n');
	if (nl < 0) return raw;
	return raw[nl - 1] === '\r' ? raw.slice(0, nl - 1) : raw.slice(0, nl);
}

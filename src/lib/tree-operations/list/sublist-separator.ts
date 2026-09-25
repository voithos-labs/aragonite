/**
 * The blank line a list whose first item is empty must have between it and the paragraph
 * directly above: a marker with no content cannot interrupt a paragraph (CommonMark § 5.2), so
 * without it those bytes reload as a setext heading.
 */

import type { CstNode } from '../../core/nodes';
import { trailingLineEnding } from '../../core/lines';

/**
 * A marker line carrying nothing after it: what Enter+Tab creates, and an emptied nested item. The
 * trailing run is required, matching `matchListItem`: a bare `-` never opened a list at all.
 */
const EMPTY_MARKER_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+$/;

/** Whether the child at `index` is a list no reload could read back where it stands. */
export function lacksSublistSeparator(children: readonly CstNode[], index: number): boolean {
	const list = children[index];
	const above = children[index - 1];
	if (!list || list.kind !== 'list' || list.leadingTrivia !== '') return false;
	if (!above || above.kind !== 'paragraph' || above.raw.trim() === '') return false;
	return EMPTY_MARKER_LINE.test(firstLineOf(list.raw));
}

/**
 * Give the child at `index` its separating line when it is a list no reload could read back.
 * Idempotent, and a no-op for every child that already stands apart, so a nesting splice or a
 * raw rebuild may call it unconditionally. The child must be owned by the live tree.
 */
export function settleSublistSeparator(children: CstNode[], index: number): void {
	if (!lacksSublistSeparator(children, index)) return;
	children[index].leadingTrivia = trailingLineEnding(children[index - 1].raw);
}

function firstLineOf(raw: string): string {
	const nl = raw.indexOf('\n');
	if (nl < 0) return raw;
	return raw[nl - 1] === '\r' ? raw.slice(0, nl - 1) : raw.slice(0, nl);
}

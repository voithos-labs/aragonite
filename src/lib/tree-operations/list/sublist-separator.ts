/**
 * The blank line a list whose first item is empty must have between it and the paragraph
 * directly above: a marker with no content cannot interrupt a paragraph (CommonMark § 5.2), so
 * without it those bytes reload as a setext heading.
 */

import type { CstNode } from '../../core/nodes';
import { firstDisplayLine, isBlankText, ownTrailingLineEnding } from '../../core/lines';
import { isContentlessItemLine } from '../../core/parsers/list';

/** Whether the child at `index` is a list no reload could read back where it stands. */
export function lacksSublistSeparator(children: readonly CstNode[], index: number): boolean {
	const list = children[index];
	const above = children[index - 1];
	if (!list || list.kind !== 'list' || list.leadingTrivia !== '') return false;
	if (!above || above.kind !== 'paragraph' || isBlankText(above.raw)) return false;
	return isContentlessItemLine(firstDisplayLine(list.raw).text);
}

/**
 * Give the child at `index` its separating line when it is a list no reload could read back.
 * Idempotent, and a no-op for every child that already stands apart, so a nesting splice or a
 * raw rebuild may call it unconditionally. The child must be owned by the live tree.
 */
export function settleSublistSeparator(children: CstNode[], index: number): void {
	if (!lacksSublistSeparator(children, index)) return;
	// The paragraph above has the list below it, so it closes its line with the document's ending.
	children[index].leadingTrivia = ownTrailingLineEnding(children[index - 1].raw);
}

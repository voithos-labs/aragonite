/**
 * Ensure a list item's `raw` ends with a line ending. Pasted items cloned
 * from clipboards without trailing newlines otherwise cause `rebuildListRaw`
 * to concatenate adjacent items' raws, mashing `"6. Ordered"` and `"7. third"`
 * into one line `"6. Ordered7. third"` — which re-parses as one item.
 *
 * The ending is a parameter, never a literal `'\n'`: an item arriving without one
 * has no ending of its own to read, so it adopts the target's (G4.20) — otherwise
 * a paste lands one LF line inside an otherwise CRLF list.
 *
 * Round-trip invariant: items at parse time keep their original no-newline
 * state (the parser populates `raw` directly without calling this helper);
 * only callers that splice items mid-list need to normalize.
 */

import type { CstNode } from '../../core/nodes';
import { trailingLineEnding } from '../../core/lines';
import { rebuildContainerRawIfContainer } from '../../schema/container-raw';

/**
 * Terminate the deepest trailing leaf, then rebuild every container above it —
 * a nested container's raw is DERIVED from its children, so appending to it
 * directly leaves the two halves disagreeing (G1.1) and its own tail item
 * unterminated, which the next rebuild mashes into the following one.
 */
function terminateDeepestLeaf(node: CstNode, ending: '\n' | '\r\n'): void {
	if (node.raw.endsWith('\n')) return;
	const children = node.children;
	if (!children || children.length === 0) {
		node.raw += ending;
		return;
	}
	terminateDeepestLeaf(children[children.length - 1], ending);
	rebuildContainerRawIfContainer(node);
}

export function ensureListItemNewlineTerminated(item: CstNode, ending: '\n' | '\r\n'): void {
	terminateDeepestLeaf(item, ending);
}

/** Normalize every pasted listItem in `items` (non-listItems pass through). */
export function newlineTerminateListItems(items: CstNode[], ending: '\n' | '\r\n'): void {
	for (const item of items) {
		if (item.kind === 'listItem') ensureListItemNewlineTerminated(item, ending);
	}
}

/**
 * THE way pasted items enter a list's children mid-array: termination is
 * welded to the splice so a new paste path can't forget it and reintroduce
 * raw-mashing during the container's rebuild. The ending comes from the
 * neighbours the items are joining — the displaced target first, then the item
 * above, then the head of the list.
 */
export function spliceTerminatedItems(
	children: CstNode[],
	at: number,
	removeCount: number,
	items: CstNode[]
): void {
	const neighbour = (removeCount > 0 ? children[at] : undefined) ?? children[at - 1] ?? children[0];
	newlineTerminateListItems(items, neighbour ? trailingLineEnding(neighbour.raw) : '\n');
	children.splice(at, removeCount, ...items);
}

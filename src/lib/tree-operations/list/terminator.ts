/**
 * Ensure a list item's `raw` ends with a line ending. Pasted items cloned
 * from clipboards without trailing newlines otherwise cause `rebuildListRaw`
 * to concatenate adjacent items' raws, mashing `"6. Ordered"` and `"7. third"`
 * into one line `"6. Ordered7. third"` — which re-parses as one item.
 *
 * Round-trip invariant: items at parse time keep their original no-newline
 * state (the parser populates `raw` directly without calling this helper);
 * only callers that splice items mid-list need to normalize.
 */

import type { CstNode } from '../../core/nodes';
import { rebuildContainerRawIfContainer } from '../../schema/container-raw';

/**
 * Terminate the deepest trailing leaf, then rebuild every container above it —
 * a nested container's raw is DERIVED from its children, so appending to it
 * directly leaves the two halves disagreeing (G1.1) and its own tail item
 * unterminated, which the next rebuild mashes into the following one.
 */
function terminateDeepestLeaf(node: CstNode): void {
	if (node.raw.endsWith('\n')) return;
	const children = node.children;
	if (!children || children.length === 0) {
		node.raw += '\n';
		return;
	}
	terminateDeepestLeaf(children[children.length - 1]);
	rebuildContainerRawIfContainer(node);
}

export function ensureListItemNewlineTerminated(item: CstNode): void {
	terminateDeepestLeaf(item);
}

/** Normalize every pasted listItem in `items` (non-listItems pass through). */
export function newlineTerminateListItems(items: CstNode[]): void {
	for (const item of items) {
		if (item.kind === 'listItem') ensureListItemNewlineTerminated(item);
	}
}

/**
 * THE way pasted items enter a list's children mid-array: termination is
 * welded to the splice so a new paste path can't forget it and reintroduce
 * raw-mashing during the container's rebuild.
 */
export function spliceTerminatedItems(
	children: CstNode[],
	at: number,
	removeCount: number,
	items: CstNode[]
): void {
	newlineTerminateListItems(items);
	children.splice(at, removeCount, ...items);
}

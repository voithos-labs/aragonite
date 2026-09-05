/**
 * Ensure a list item's `raw` ends with a line ending. Without it `rebuildListRaw`
 * concatenates adjacent items' raws into one line, which re-parses as one item. The
 * ending is a parameter, never a literal `'\n'`: an item arriving without one adopts the
 * target's (G4.20), or a paste strands an LF line inside a CRLF list. Parse-time items
 * keep their original state; only mid-list splices normalize.
 */

import type { CstNode } from '../../core/nodes';
import { trailingLineEnding } from '../../core/lines';
import { spliceMany } from '../splice-many';
import { rebuildContainerRawIfContainer } from '../../schema/container-raw';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';

/**
 * The child holding the node's last LINE, or null when the node's own raw holds it. Only a
 * strip container serializes its children's raws as whole lines; a grid cell and an opaque
 * body live inside a line their container emits, so the ending belongs to the container.
 */
function lastLineOwningChild(node: CstNode): CstNode | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'strip') return null;
	const children = node.children;
	if (!children || children.length === 0) return null;
	return children[children.length - 1];
}

/**
 * Terminate the deepest node that owns its own last line, then rebuild every strip container
 * above it: such a container's raw is DERIVED from its children, so appending to it directly
 * leaves the two disagreeing (G1.1) and its tail item still unterminated.
 */
function terminateLastLine(node: CstNode, ending: '\n' | '\r\n'): void {
	if (node.raw.endsWith('\n')) return;
	const child = lastLineOwningChild(node);
	if (!child) {
		node.raw += ending;
		return;
	}
	terminateLastLine(child, ending);
	rebuildContainerRawIfContainer(node);
}

export function ensureListItemNewlineTerminated(item: CstNode, ending: '\n' | '\r\n'): void {
	terminateLastLine(item, ending);
}

/** Normalize every pasted listItem in `items` (non-listItems pass through). */
export function newlineTerminateListItems(items: CstNode[], ending: '\n' | '\r\n'): void {
	for (const item of items) {
		if (item.kind === 'listItem') ensureListItemNewlineTerminated(item, ending);
	}
}

/**
 * THE way pasted items enter a list's children mid-array: termination is welded to the
 * splice so a new paste path cannot forget it. The ending comes from the neighbours the
 * items join — displaced target, then the item above, then the list head.
 */
export function spliceTerminatedItems(
	children: CstNode[],
	at: number,
	removeCount: number,
	items: CstNode[]
): void {
	const neighbour = (removeCount > 0 ? children[at] : undefined) ?? children[at - 1] ?? children[0];
	newlineTerminateListItems(items, neighbour ? trailingLineEnding(neighbour.raw) : '\n');
	spliceMany(children, at, removeCount, items);
}

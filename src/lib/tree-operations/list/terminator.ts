/**
 * Ensure a list item's `raw` ends with a line ending, or `rebuildListRaw` joins adjacent items
 * into one line that reloads as one item. The ending is the document's, or a paste strands an LF
 * line in a CRLF list. Only mid-list splices normalize.
 */

import type { CstNode } from '../../core/nodes';
import type { LineEnding } from '../../core/lines';
import { spliceMany } from '../splice-many';
import { rebuildContainerRawIfContainer } from '../../schema/container-raw';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';

/**
 * The child holding the node's last line, or null when the node's own raw holds it. Only a
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
 * above it: such a container's raw is derived from its children, so appending to it directly
 * leaves the two disagreeing (G1.1) and its tail item still unterminated.
 */
export function terminateLastLine(node: CstNode, ending: LineEnding): void {
	if (node.raw.endsWith('\n')) return;
	const child = lastLineOwningChild(node);
	if (!child) {
		node.raw += ending;
		return;
	}
	terminateLastLine(child, ending);
	rebuildContainerRawIfContainer(node);
}

export function ensureListItemNewlineTerminated(item: CstNode, ending: LineEnding): void {
	terminateLastLine(item, ending);
}

/** Normalize every pasted listItem in `items` (non-listItems pass through). */
export function newlineTerminateListItems(items: CstNode[], ending: LineEnding): void {
	for (const item of items) {
		if (item.kind === 'listItem') ensureListItemNewlineTerminated(item, ending);
	}
}

/**
 * The one way pasted items enter a list's children mid-array: termination is tied to the
 * splice so a new paste path cannot forget it. `ending` is the document's.
 */
export function spliceTerminatedItems(
	children: CstNode[],
	at: number,
	removeCount: number,
	items: CstNode[],
	ending: LineEnding
): void {
	newlineTerminateListItems(items, ending);
	spliceMany(children, at, removeCount, items);
}

/**
 * The line ending at the end of a block's last line, written through the containers above it. A
 * list item without one joins the next item on reload, so pasted items take the document's
 * ending (an LF line in a CRLF list otherwise); a move gives it to the block that gains a
 * follower.
 */

import type { CstNode } from '../../core/nodes';
import { terminateLine, trimTrailingLineEnding, type LineEnding } from '../../core/lines';
import { spliceMany } from '../splice-many';
import type { SharingState } from '../sharing';
import { ensureUnsharedChild } from '../unshare';
import { dropChildSpans } from '../../schema/child-spans';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';

/**
 * End the node's last line in `ending`, in its own raw and in every node below that holds the same
 * line, so a container keeps the bytes of its other lines (a quote's lazy continuation lines) as
 * they are. With `sharing`, each node below `node` is copied first.
 */
export function terminateLastLine(node: CstNode, ending: LineEnding, sharing?: SharingState): void {
	rewriteLastLine(node, (raw) => terminateLine(raw, ending), sharing);
}

/** {@link terminateLastLine}'s inverse, for a block that becomes a document's unended last line. */
export function releaseLastLine(node: CstNode, sharing?: SharingState): void {
	rewriteLastLine(node, trimTrailingLineEnding, sharing);
}

function rewriteLastLine(
	node: CstNode,
	write: (raw: string) => string,
	sharing: SharingState | undefined
): void {
	const wasEnded = node.raw.endsWith('\n');
	const raw = write(node.raw);
	if (raw === node.raw) return;
	node.raw = raw;
	const last = (node.children?.length ?? 0) - 1;
	if (last < 0) return;
	const contract = getBlockKindDescriptor(node.kind).containerContract;
	if (contract === 'strip') {
		dropChildSpans(node);
		// A blank line closing the body is the last line; the parser keeps it out of the suffix
		// while it is unended, so a last child already ended the other way marks it too.
		if (node.innerSuffix || node.children![last].raw.endsWith('\n') !== wasEnded) {
			node.innerSuffix = write(node.innerSuffix ?? '');
			return;
		}
	} else if (contract !== 'grid' || !isGrid(node.children![last])) {
		// A grid's rows are whole lines; a row's cells and an opaque body sit inside a line.
		return;
	}
	const child = sharing ? ensureUnsharedChild(node, last, sharing) : node.children![last];
	rewriteLastLine(child, write, sharing);
}

function isGrid(node: CstNode): boolean {
	return getBlockKindDescriptor(node.kind).containerContract === 'grid';
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

/**
 * Where a caret lands for a position that may name a container, a collapsed container's hidden
 * body, or the slot a removed block left, decided on the tree alone before anything mounts. A
 * collapsed container counts as its title row throughout, so no answer here opens one.
 */

import type { DocumentView } from '../core/node-views';
import { CURSOR_END, CURSOR_START, entryEdge } from '../block-component';
import { docPathFrom } from '../cursor/coordinate-spaces';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { leafAtRawOffset } from '../tree-operations/container-offsets';
import { caretChildCount } from '../schema/reserved-chrome';
import type { DocPath } from './path-math';
import type { CaretPosition } from './primitives';
import { collapsedContainerHiding, firstCaretLeafFrom, previousCaretPath } from './path-lookup';

/** A leaf a caret can sit in, and the offset it takes there. */
export interface CaretTarget {
	readonly leafPath: DocPath;
	readonly offset: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * The leaf a caret at `pos` sits in, and its offset there; null when the path no longer
 * resolves. A path into a collapsed body lands at the end of that container's title row unless
 * `openCollapsed` is set, which only a navigation that opens the container passes.
 */
export function caretTargetFor(
	doc: DocumentView,
	pos: CaretPosition,
	opts: { openCollapsed?: boolean } = {}
): CaretTarget | null {
	let path = [...pos.path];
	let offset = pos.offset;
	if (!nodeAt(doc, path)) return null;
	for (;;) {
		const hiding = opts.openCollapsed ? null : collapsedContainerHiding(doc, path);
		if (hiding) {
			path = [...hiding, 0];
			offset = CURSOR_END;
		}
		const node = nodeAt(doc, path)!;
		if (!node.children?.length) return { leafPath: docPathFrom(path), offset };
		const edge = entryEdge(offset);
		const byteLeaf = edge.inside && isBlockNode(node) ? leafAtRawOffset(node, offset) : null;
		if (byteLeaf) {
			path = [...path, ...byteLeaf.path];
			offset = byteLeaf.offset;
			continue;
		}
		const reachable = isBlockNode(node) ? caretChildCount(node) : node.children.length;
		path = [...path, edge.child === 'first' ? 0 : reachable - 1];
		offset = edge.offset;
	}
}

/**
 * Where the caret goes once the block at `removedPath` is gone, read on the tree after the
 * removal. `'before'` (Backspace, and a removal with no key) takes the end of the previous
 * block, else the start of the next; `'after'` (Delete) the reverse. Null for an emptied document.
 */
export function survivorAfterRemoval(
	doc: DocumentView,
	removedPath: readonly number[],
	side: 'before' | 'after'
): CaretPosition | null {
	const slot = liveSlot(doc, removedPath);
	if (!slot) return null;
	const previous = previousCaretPath(doc, slot);
	const next = firstCaretLeafFrom(doc, slot);
	const atEnd = previous && { path: docPathFrom(previous), offset: CURSOR_END };
	const atStart = next && { path: docPathFrom(next), offset: CURSOR_START };
	return side === 'before' ? (atEnd ?? atStart) : (atStart ?? atEnd);
}

// ── Internal ────────────────────────────────────────────────────────────────

/** `removedPath`, or the slot of its nearest ancestor when the removal emptied the parent and the
 *  commit's fix-up took it too (its path then resolves to nothing, or to a childless neighbour). */
function liveSlot(doc: DocumentView, removedPath: readonly number[]): number[] | null {
	let slot = [...removedPath];
	while (slot.length > 1 && !nodeAt(doc, slot.slice(0, -1))?.children?.length) {
		slot = slot.slice(0, -1);
	}
	return slot.length > 0 ? slot : null;
}

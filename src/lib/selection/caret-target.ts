/**
 * Where a caret lands for a position that may name a container, a collapsed container's hidden
 * body, or the position a removed block left, decided on the tree alone before anything mounts. A
 * collapsed container counts as its title row throughout, so no answer here opens one.
 */

import type { DocumentView } from '../core/node-views';
import { CURSOR_END, CURSOR_START, entryEdge } from '../block-component';
import { docPathFrom } from '../cursor/coordinate-spaces';
import { blockNodeAt, isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { displayLength } from '../core/lines';
import { leafAtRawOffset } from '../tree-operations/container-offsets';
import { caretChildCount } from '../schema/reserved-chrome';
import type { DocPath } from './path-math';
import type { CaretPosition, SelectionPoint } from './primitives';
import { collapsedContainerHiding, firstCaretLeafFrom, previousCaretPath } from './path-lookup';

/** A leaf a caret can sit in, and the offset it takes there. */
export interface CaretTarget {
	readonly leafPath: DocPath;
	readonly offset: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** The leaf and offset a caret at `pos` takes, or null for a path that addresses nothing. A
 *  path into a collapsed body lands at its title row's end unless `openCollapsed` is set. */
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
		if (!node.children?.length) {
			return path.length > 0 ? { leafPath: docPathFrom(path), offset } : null;
		}
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

/** {@link caretTargetFor} as a byte a range edit can splice at: a start edge is the leaf's first
 *  byte and an end edge its last, for the range edits that still type or paste at the caret. */
export function caretPointFor(doc: DocumentView, pos: CaretPosition): SelectionPoint | null {
	const target = caretTargetFor(doc, pos);
	if (!target) return null;
	const leaf = blockNodeAt(doc, target.leafPath);
	// The start sentinels are the negative ones.
	const offset =
		target.offset === CURSOR_END ? displayLength(leaf?.raw ?? '') : Math.max(0, target.offset);
	return { path: [...target.leafPath], offset };
}

/** Which way a delete points: Backspace and a delete with no key `'before'`, Delete and cut
 *  `'after'`. */
export type RemovalSide = 'before' | 'after';

/** Where the caret goes once the block at `removedPath` is gone, read on the tree after the
 *  removal: `'before'` prefers the previous block's end, `'after'` the next block's start. */
export function survivorAfterRemoval(
	doc: DocumentView,
	removedPath: readonly number[],
	side: RemovalSide
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

/** `removedPath`, or its nearest ancestor's position when the removal emptied the parent and the
 *  commit's fix-up took it too (its path then resolves to nothing, or to a childless neighbour). */
function liveSlot(doc: DocumentView, removedPath: readonly number[]): number[] | null {
	let slot = [...removedPath];
	while (slot.length > 1 && !nodeAt(doc, slot.slice(0, -1))?.children?.length) {
		slot = slot.slice(0, -1);
	}
	return slot.length > 0 ? slot : null;
}

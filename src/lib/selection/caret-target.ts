/**
 * Where a caret lands for a position that may name a container, a collapsed container's hidden
 * body, or the position a removed block left, decided on the tree alone before anything mounts. A
 * collapsed container counts as its title row throughout, so no answer here opens one.
 */

import type { DocumentView } from '../core/node-views';
import { CURSOR_END, entryEdge } from '../block-component';
import { docPathFrom } from '../core/coordinate-spaces';
import { blockNodeAt, isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { displayLength } from '../core/lines';
import { splitsLineEndingPair } from '../core/line-ending-pairs';
import { leafAtRawOffset } from '../tree-operations/container-offsets';
import { caretChildCount } from '../schema/reserved-chrome';
import type { DocPath } from '../core/coordinate-spaces';
import type { CaretPosition, SelectionPoint } from './primitives';
import { collapsedContainerHiding } from './path-lookup';

/** A leaf a caret can sit in, and the offset it takes there. */
export interface CaretTarget {
	readonly leafPath: DocPath;
	readonly offset: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** The leaf and offset a caret at `pos` takes, or null where it addresses nothing: a collapsed body
 *  gives its title row's end (unless `openCollapsed`), a CRLF pair's middle the byte before it. */
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
			if (path.length === 0) return null;
			const inPair = isBlockNode(node) && splitsLineEndingPair(node.raw, offset);
			return { leafPath: docPathFrom(path), offset: inPair ? offset - 1 : offset };
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

/** What removed a block: the key pressed (by its `KeyboardEvent.key`), a cut, or a delete no key
 *  asked for (the block menu, or typing and pasting over a range). */
export type RemovalGesture = 'Backspace' | 'Delete' | 'cut' | 'keyless';

/** `removedPath`, or its nearest ancestor's position when the removal emptied the parent and took
 *  it too (the path then resolves to nothing, or to a childless neighbour or the new empty block). */
export function liveSlot(doc: DocumentView, removedPath: readonly number[]): number[] | null {
	let slot = [...removedPath];
	while (slot.length > 1 && !nodeAt(doc, slot.slice(0, -1))?.children?.length) {
		slot = slot.slice(0, -1);
	}
	return slot.length > 0 ? slot : null;
}

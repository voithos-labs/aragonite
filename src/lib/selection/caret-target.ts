/**
 * Where a caret lands for a position that may name a container, a collapsed container's hidden
 * body, or the position a removed block left, decided on the tree alone before anything mounts. A
 * collapsed container counts as its title row throughout, so no answer here opens one.
 */

import type { DocumentView } from '../core/node-views';
import { CURSOR_END, CURSOR_START, entryEdge } from '../block-component';
import { docPathFrom } from '../caret/coordinate-spaces';
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

/** What removed a block: the key pressed (by its `KeyboardEvent.key`), a cut, or a delete no key
 *  asked for (the block menu, or typing and pasting over a range). */
export type RemovalGesture = 'Backspace' | 'Delete' | 'cut' | 'keyless';

/** Where the caret goes once the block at `removedPath` is gone, read after the removal: Backspace
 *  and a keyless delete prefer the previous block's end, Delete and cut the next block's start. */
export function survivorAfterRemoval(
	doc: DocumentView,
	removedPath: readonly number[],
	gesture: RemovalGesture
): CaretPosition | null {
	return survivorBeside(doc, removedPath, pointsForward(gesture));
}

/** Delete and cut land a removed block's caret on the next block; Backspace and a keyless delete
 *  on the previous one. */
export function pointsForward(gesture: RemovalGesture): boolean {
	return gesture === 'Delete' || gesture === 'cut';
}

/** The neighbour a caret takes beside a removed block: the one on the `forward` side, else
 *  whichever exists. Read after the removal and, by a command key's claim, before it. */
export function neighbourBeside<T>(forward: boolean, before: T | null, after: T | null): T | null {
	return forward ? (after ?? before) : (before ?? after);
}

/** Where a range picks up once it took the block at `removedPath` whole and ran on past it: the
 *  start of what's left of its end, whatever removed it. */
export function survivorWhereRangeResumes(
	doc: DocumentView,
	removedPath: readonly number[]
): CaretPosition | null {
	return survivorBeside(doc, removedPath, true);
}

// ── Internal ────────────────────────────────────────────────────────────────

function survivorBeside(
	doc: DocumentView,
	removedPath: readonly number[],
	forward: boolean
): CaretPosition | null {
	const slot = liveSlot(doc, removedPath);
	if (!slot) return null;
	const previous = previousCaretPath(doc, slot);
	const next = firstCaretLeafFrom(doc, slot);
	const atEnd = previous && { path: docPathFrom(previous), offset: CURSOR_END };
	const atStart = next && { path: docPathFrom(next), offset: CURSOR_START };
	return neighbourBeside<CaretPosition>(forward, atEnd, atStart);
}

/** `removedPath`, or its nearest ancestor's position when the removal emptied the parent and took
 *  it too (the path then resolves to nothing, or to a childless neighbour or the new empty block). */
function liveSlot(doc: DocumentView, removedPath: readonly number[]): number[] | null {
	let slot = [...removedPath];
	while (slot.length > 1 && !nodeAt(doc, slot.slice(0, -1))?.children?.length) {
		slot = slot.slice(0, -1);
	}
	return slot.length > 0 ? slot : null;
}

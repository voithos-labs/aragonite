/**
 * Resolve the reorderable unit a path points into: the nearest ancestor slot
 * whose parent is a sibling-permutable container (document, list, blockquote).
 * A list item's focused leaf lives at `[list, item, paragraph]`, but the unit
 * that moves is the item under the list — so the resolver walks up from the
 * leaf past non-reorderable parents (the item itself) to that slot.
 *
 * An opaque plugin container (admonition, callout, `<details>`) is a hard
 * boundary: reorder DECLINES there rather than walking past to the document,
 * which would teleport the whole container to a top-level index. The walk is
 * leaf-first, so a native list/blockquote nested inside the opaque body still
 * wins before the boundary is reached.
 */

import type { Document } from '../core/nodes';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { nodeAt } from './node-ops';

export type ReorderParentKind = 'document' | 'list' | 'blockquote';

const REORDERABLE_PARENT = new Set<string>(['document', 'list', 'blockquote']);

export interface ReorderUnit {
	parentPath: number[];
	index: number;
	parentKind: ReorderParentKind;
}

export function resolveReorderUnit(doc: Document, path: number[]): ReorderUnit | null {
	for (let depth = path.length; depth >= 1; depth--) {
		const parentPath = path.slice(0, depth - 1);
		const parentKind = parentPath.length === 0 ? 'document' : nodeAt(doc, parentPath)?.kind;
		if (parentKind && REORDERABLE_PARENT.has(parentKind)) {
			return { parentPath, index: path[depth - 1], parentKind: parentKind as ReorderParentKind };
		}
		if (
			parentKind &&
			parentKind !== 'document' &&
			tryGetBlockKindDescriptor(parentKind)?.containerContract === 'opaque'
		) {
			return null;
		}
	}
	return null;
}

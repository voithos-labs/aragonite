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

export interface ReorderUnit {
	parentPath: number[];
	index: number;
	parentKind: ReorderParentKind;
}

export function resolveReorderUnit(doc: Document, path: number[]): ReorderUnit | null {
	for (let depth = path.length; depth >= 1; depth--) {
		const parentPath = path.slice(0, depth - 1);
		// The document root is identified STRUCTURALLY, never by a kind string a
		// plugin could mint: a non-root node whose kind is 'document' is just another
		// container, resolved by its descriptor below (the isBlockNode 'document'-alias
		// hazard, now closed here too).
		if (parentPath.length === 0) {
			return { parentPath, index: path[depth - 1], parentKind: 'document' };
		}
		const parentKind = nodeAt(doc, parentPath)?.kind;
		if (parentKind === 'list' || parentKind === 'blockquote') {
			return { parentPath, index: path[depth - 1], parentKind };
		}
		if (parentKind && tryGetBlockKindDescriptor(parentKind)?.containerContract === 'opaque') {
			return null;
		}
	}
	return null;
}

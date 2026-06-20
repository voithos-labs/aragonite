/**
 * Resolve the reorderable unit a path points into: the nearest ancestor slot
 * whose parent is a sibling-permutable container (document, list, blockquote).
 * A list item's focused leaf lives at `[list, item, paragraph]`, but the unit
 * that moves is the item under the list — so the resolver walks up from the
 * leaf past non-reorderable parents (the item itself) to that slot.
 */

import type { Document } from '../core/nodes';
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
	}
	return null;
}

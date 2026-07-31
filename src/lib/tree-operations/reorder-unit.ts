/**
 * Resolve the reorderable unit a path points into: the nearest ancestor slot whose parent
 * reorders its children among themselves. Membership is the parent's declared
 * `reorderChildren` capability, never a kind name, so a plugin container opts in as the
 * built-ins do. An opaque container is a hard boundary — reorder DECLINES there rather
 * than walking past to the document and teleporting the container to a top-level index.
 */

import type { Document } from '../core/nodes';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { nodeAt } from './node-ops';

export interface ReorderUnit {
	parentPath: number[];
	index: number;
	/** The root reorders structurally; a container reorders through its own commit scope. */
	scope: 'document' | 'container';
	/** The parent renumbers position-dependent child markers after the move (ordered list). */
	renumberMarkers: boolean;
}

export function resolveReorderUnit(doc: Document, path: number[]): ReorderUnit | null {
	for (let depth = path.length; depth >= 1; depth--) {
		const parentPath = path.slice(0, depth - 1);
		// The root is identified structurally, never by kind: a plugin may mint 'document'
		// as a block kind, and such a node is just another container.
		if (parentPath.length === 0) {
			return { parentPath, index: path[depth - 1], scope: 'document', renumberMarkers: false };
		}
		const parentKind = nodeAt(doc, parentPath)?.kind;
		// `!== 'document'` narrows out the root's kind at the type level (nodeAt widens to
		// include it); at runtime the root is already handled above.
		if (parentKind && parentKind !== 'document') {
			const descriptor = tryGetBlockKindDescriptor(parentKind);
			const reorderChildren = descriptor?.reorderChildren;
			if (reorderChildren) {
				return {
					parentPath,
					index: path[depth - 1],
					scope: 'container',
					renumberMarkers: reorderChildren.renumberMarkers ?? false
				};
			}
			if (descriptor?.containerContract === 'opaque') return null;
		}
	}
	return null;
}

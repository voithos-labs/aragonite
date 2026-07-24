/**
 * Resolve the reorderable unit a path points into: the nearest ancestor slot
 * whose parent reorders its children among themselves. A list item's focused
 * leaf lives at `[list, item, paragraph]`, but the unit that moves is the item
 * under the list — so the resolver walks up from the leaf past non-reorderable
 * parents (the item itself) to that slot.
 *
 * Reorder-within membership is the parent descriptor's declared `reorderChildren`
 * capability, never a kind name: a plugin strip container (githubAlert,
 * footnote-def) opts in exactly as the built-in blockquote/list do.
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

export interface ReorderUnit {
	parentPath: number[];
	index: number;
	/**
	 * The document root reorders structurally (no container raw); a container
	 * reorders through its own commit scope, whose raw the ceremony rebuilds
	 * through the descriptor.
	 */
	scope: 'document' | 'container';
	/** The parent renumbers position-dependent child markers after the move (ordered list). */
	renumberMarkers: boolean;
}

export function resolveReorderUnit(doc: Document, path: number[]): ReorderUnit | null {
	for (let depth = path.length; depth >= 1; depth--) {
		const parentPath = path.slice(0, depth - 1);
		// The document root is identified STRUCTURALLY, never by a kind string a
		// plugin could mint: a non-root node whose kind is 'document' is just another
		// container, resolved by its descriptor below (the isBlockNode 'document'-alias
		// hazard, closed here too).
		if (parentPath.length === 0) {
			return { parentPath, index: path[depth - 1], scope: 'document', renumberMarkers: false };
		}
		const parentKind = nodeAt(doc, parentPath)?.kind;
		// `!== 'document'` narrows out the Document root's kind at the type level (nodeAt
		// widens to include it); at runtime the root is already handled above.
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

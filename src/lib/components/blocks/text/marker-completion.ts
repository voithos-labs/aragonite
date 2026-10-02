/**
 * The space that finishes a container's marker. The parser creates the container on the bare
 * marker byte (`>`), before the space arrives, so that space belongs to the marker and not to
 * the child the caret landed in. The container declares this with `contentStartSpace`; nothing
 * here is keyed on a kind name.
 */

import { displayLength } from '../../../core/lines';
import { isProseKind } from '../../../core/inline';
import type { NodeView } from '../../../core/node-views';
import { markerSpaceAt, takesMarkerSpace } from '../../../tree-operations/container-offsets';

/** `empty-child`: the container spells the line itself once text arrives, so nothing is written.
 *  `bare-marker`: text already follows the marker, so the caller writes the space into its line. */
export type MarkerClaim = 'empty-child' | 'bare-marker';

export interface MarkerCompletion {
	/** Take a bare space at `caretOffset` for the nearest container's marker (`parent`, null at the
	 *  root), once per child: a second space there is content, the only way to type a leading one. */
	claimSpace(
		node: NodeView,
		parent: NodeView | null,
		index: number,
		caretOffset: number
	): MarkerClaim | null;
}

export function createMarkerCompletion(): MarkerCompletion {
	// The node, not a bare flag: an element reused for another child, or the same child recreated
	// by a commit's copy-before-write, needs a fresh completion.
	let claimedFor: NodeView | null = null;
	return {
		claimSpace(node, parent, index, caretOffset) {
			if (caretOffset !== 0 || !parent || !isProseKind(node.kind)) return null;
			const empty = displayLength(node.raw) === 0;
			if (empty ? !takesMarkerSpace(parent) : markerSpaceAt(parent, index) === null) return null;
			if (claimedFor === node) return null;
			claimedFor = node;
			return empty ? 'empty-child' : 'bare-marker';
		}
	};
}

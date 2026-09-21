/**
 * The space that finishes a container's marker. The parser creates the container on the bare
 * marker byte (`>`), before the space arrives, so that space belongs to the marker and not to
 * the empty child the caret landed in. The container declares this with `contentStartSpace`;
 * nothing here is keyed on a kind name.
 */

import { displayLength } from '../../../core/lines';
import { isProseKind } from '../../../core/inline';
import type { NodeView } from '../../../core/node-views';
import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';

export interface MarkerCompletion {
	/**
	 * Take a bare space at `caretOffset` for the container's marker, or leave it to the content.
	 * `parent` is the block's nearest ancestor container, so a nested quote completes at its own
	 * depth, and null at the document root. Taken once per child: a taken space writes nothing,
	 * so only this memory tells the second space from the first, and the second is the only way
	 * to type a leading space inside an empty quoted line.
	 */
	claimSpace(node: NodeView, parent: NodeView | null, caretOffset: number): boolean;
}

export function createMarkerCompletion(): MarkerCompletion {
	// The node, not a bare flag: an element reused for another child, or the same child recreated
	// by a commit's copy-before-write, needs a fresh completion.
	let claimedFor: NodeView | null = null;
	return {
		claimSpace(node, parent, caretOffset) {
			if (caretOffset !== 0 || !parent) return false;
			if (!isProseKind(node.kind) || displayLength(node.raw) !== 0) return false;
			if (tryGetBlockKindDescriptor(parent.kind)?.contentStartSpace !== 'complete-marker') {
				return false;
			}
			if (claimedFor === node) return false;
			claimedFor = node;
			return true;
		}
	};
}

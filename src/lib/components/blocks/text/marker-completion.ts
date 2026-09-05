/**
 * The space that finishes a container's marker. An opener firing on the bare marker byte
 * (`>`) mints the container before the space arrives, so that space belongs to the marker
 * and not to the empty child the caret landed in. Declared by the container
 * (`contentStartSpace`), never by kind name here.
 */

import { displayLength } from '../../../core/lines';
import { isProseKind } from '../../../core/inline';
import type { NodeView } from '../../../core/node-views';
import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';

export interface MarkerCompletion {
	/**
	 * Claim a bare space at `caretOffset` for the container's marker, or decline it to the
	 * content. `parent` is the block's NEAREST ancestor container — a nested quote completes at
	 * its own depth — or null at the document root. One claim per child: a claimed space writes
	 * nothing, so only this memory tells press 2 from press 1, and press 2 is the only way to
	 * type a leading space inside an empty quoted line.
	 */
	claimSpace(node: NodeView, parent: NodeView | null, caretOffset: number): boolean;
}

export function createMarkerCompletion(): MarkerCompletion {
	// The node, not a bare flag: a surface re-used for another child — or the same child re-minted
	// by a commit's copy-path-on-write — owes a fresh completion.
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

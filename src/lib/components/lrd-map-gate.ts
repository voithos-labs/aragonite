// When to rebuild the link reference definition map, and the counter that render caches key on.

import type { DocumentView } from '../core/node-views';
import type { EditEvent } from '../editor-events';
import { nodeAt } from '../tree-operations/node-primitives';

/**
 * Whether a commit could change the set of link reference definitions, keeping the
 * whole-document map rebuild off the keystroke hot path. Any op but `input` or
 * `metadataUpdate` could add or remove one; those two only can when the block they touch is
 * itself a definition, since neither changes a block's kind (the lint under
 * `test/invariants/lint/` holds that for `input`).
 */
export function lrdMapCouldChange(doc: DocumentView, event: EditEvent): boolean {
	if (event.op !== 'input' && event.op !== 'metadataUpdate') return true;
	return nodeAt(doc, event.path)?.kind === 'linkReferenceDefinition';
}

/**
 * A counter that changes exactly when the signature string does. Render caches for blocks
 * holding references key on the counter instead of the whole (~MB) signature, so bumping it
 * on every rebuild would re-render every block with a bracket in it.
 */
export function advanceSignatureEpoch(
	prevSignature: string,
	prevEpoch: number,
	nextSignature: string
): { signature: string; epoch: number } {
	if (nextSignature === prevSignature) return { signature: prevSignature, epoch: prevEpoch };
	return { signature: nextSignature, epoch: prevEpoch + 1 };
}

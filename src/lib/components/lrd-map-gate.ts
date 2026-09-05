import type { DocumentView } from '../core/node-views';
import type { EditEvent } from '../editor-events';
import { nodeAt } from '../tree-operations/node-ops';

/**
 * Whether a commit could change the LRD set, keeping the O(nodes) map rebuild off the keystroke
 * hot path. Any op that is not a kind-stable `input`/`metadataUpdate` could add or remove a
 * definition; a kind-stable one only can when its target is itself an LRD. `input` is kind-stable
 * by construction, held by the input-op kind-stability lint under `test/invariants/lint/`.
 */
export function lrdMapCouldChange(doc: DocumentView, event: EditEvent): boolean {
	if (event.op !== 'input' && event.op !== 'metadataUpdate') return true;
	return nodeAt(doc, event.path)?.kind === 'linkReferenceDefinition';
}

/**
 * A monotonic stamp that changes **exactly** when the signature string does.
 * Reference-bearing render memos key on the epoch instead of the whole (~MB)
 * signature, so bumping on every rebuild would re-render every bracket-bearing block.
 */
export function advanceSignatureEpoch(
	prevSignature: string,
	prevEpoch: number,
	nextSignature: string
): { signature: string; epoch: number } {
	if (nextSignature === prevSignature) return { signature: prevSignature, epoch: prevEpoch };
	return { signature: nextSignature, epoch: prevEpoch + 1 };
}

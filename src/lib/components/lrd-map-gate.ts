// When to rebuild the link reference definition map, and the counter that render caches key on.

import type { DocumentView } from '../core/node-views';
import type { EditEvent } from '../editor-events';
import { nodeAt } from '../tree-operations/node-primitives';

/** Keeps the whole-document map rebuild off the keystroke path: `input` and `metadataUpdate`
 *  never change a block's kind, so they matter only when the block is itself a definition. */
export function lrdMapCouldChange(doc: DocumentView, event: EditEvent): boolean {
	if (event.op !== 'input' && event.op !== 'metadataUpdate') return true;
	return nodeAt(doc, event.path)?.kind === 'linkReferenceDefinition';
}

/** Changes exactly when the signature does: render caches key on it rather than the (~MB)
 *  signature, and a bump per rebuild would re-render every block with a bracket in it. */
export function advanceSignatureEpoch(
	prevSignature: string,
	prevEpoch: number,
	nextSignature: string
): { signature: string; epoch: number } {
	if (nextSignature === prevSignature) return { signature: prevSignature, epoch: prevEpoch };
	return { signature: nextSignature, epoch: prevEpoch + 1 };
}

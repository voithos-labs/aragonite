/**
 * Gate for the link-reference-definition map rebuild. The shell rebuilds the
 * label→target map after a commit only when the LRD set could have changed,
 * keeping the O(nodes) walk off the keystroke hot path for the common
 * (LRD-free) document.
 */
import type { Document } from './core/nodes';
import type { EditEvent } from './editor-events';
import { nodeAt } from './tree-operations/node-ops';

const INTRA_BLOCK_OPS: ReadonlySet<EditEvent['op']> = new Set([
	'input',
	'updateContent',
	'metadataUpdate'
]);

/**
 * Whether a commit could change the LRD set. Rebuild on any structural commit;
 * on an intra-block edit, rebuild only when the doc already holds an LRD
 * (`currentSignature` non-empty — a kind-change carries an intra `op`, so this
 * conservatively covers an LRD being edited away) or the edited node is now an
 * LRD (the first definition created in a previously LRD-free doc). An LRD-free
 * doc skips the walk on routine typing.
 */
export function lrdMapCouldChange(
	doc: Document,
	event: EditEvent,
	currentSignature: string
): boolean {
	if (!INTRA_BLOCK_OPS.has(event.op)) return true;
	if (currentSignature !== '') return true;
	return nodeAt(doc, event.path)?.kind === 'linkReferenceDefinition';
}

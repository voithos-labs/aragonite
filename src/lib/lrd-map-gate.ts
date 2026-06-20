/**
 * Gate for the link-reference-definition map rebuild. The shell rebuilds the
 * label→target map after a commit only when the LRD set could have changed,
 * keeping the O(nodes) walk off the keystroke hot path for the common
 * (LRD-free) document.
 */
import type { Document } from './core/nodes';
import type { EditEvent } from './editor-events';
import { nodeAt } from './tree-operations/node-ops';

/**
 * Whether a commit could change the LRD set, gating the O(nodes) map rebuild off
 * the keystroke hot path. The op discriminates the two ways the set changes:
 *
 *   - A kind change to/from `linkReferenceDefinition` commits structurally as
 *     `updateContent` (the noop-kind-stable path emits the debounced `input`
 *     instead), so any op that is NOT a kind-stable `input`/`metadataUpdate`
 *     could add or remove a definition — rebuild.
 *   - A kind-stable edit can only change the set if it edits a definition's own
 *     bytes (label/url/title) — so an `input`/`metadataUpdate` rebuilds only
 *     when its target node is itself an LRD.
 *
 * Net: typing in an ordinary paragraph never walks the doc, even in a
 * definition-dense document.
 */
export function lrdMapCouldChange(doc: Document, event: EditEvent): boolean {
	if (event.op !== 'input' && event.op !== 'metadataUpdate') return true;
	return nodeAt(doc, event.path)?.kind === 'linkReferenceDefinition';
}

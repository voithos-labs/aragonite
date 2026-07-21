import type { DocumentView } from '../core/node-views';
import type { EditEvent } from '../editor-events';
import { nodeAt } from '../tree-operations/node-ops';

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
export function lrdMapCouldChange(doc: DocumentView, event: EditEvent): boolean {
	if (event.op !== 'input' && event.op !== 'metadataUpdate') return true;
	return nodeAt(doc, event.path)?.kind === 'linkReferenceDefinition';
}

/**
 * Advance the LRD signature epoch: a monotonic stamp that changes **exactly** when
 * the signature string changes. Reference-bearing render memos fold the epoch into
 * their key instead of the whole signature (~MB scale in reference-heavy docs), so
 * the invariant is load-bearing — a stamp that bumped on every rebuild would
 * over-invalidate every bracket-bearing block per commit. Returns the previous
 * pair unchanged when the signature is unchanged; bumps once when it differs.
 */
export function advanceSignatureEpoch(
	prevSignature: string,
	prevEpoch: number,
	nextSignature: string
): { signature: string; epoch: number } {
	if (nextSignature === prevSignature) return { signature: prevSignature, epoch: prevEpoch };
	return { signature: nextSignature, epoch: prevEpoch + 1 };
}

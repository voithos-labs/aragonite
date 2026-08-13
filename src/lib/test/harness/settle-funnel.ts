/**
 * The two steps every top-level structural commit runs, for suites driving the primitives
 * directly: the sink over the slotless body parent production hands it, then the ceremony's
 * settle over the document's folded tail line. A test calling the sink alone hands it a parent
 * production never passes, and passes vacuously for everything the settle owns.
 */

import type { CstNode, Document } from '$lib/core/nodes';
import type { BodyParent } from '$lib/tree-operations/node-ops';
import { settleSeparator, type SeparatorParent } from '$lib/tree-operations/node-ops';
import type { StructuralChange } from '$lib/tree-operations/structural-change';

/** `editor-actions/block-edit-core.bodyParentOf` — no `suffix` slot, by contract. */
const bodyParentOf = (doc: Document): BodyParent => ({
	children: doc.children,
	ownerKind: undefined,
	owner: undefined
});

/** `editor-actions/commit/undo-controller.docSettleParent`. */
function settleParentOf(doc: Document): SeparatorParent {
	return {
		kind: 'document',
		children: doc.children,
		get suffix() {
			return doc.suffix;
		},
		set suffix(value: string) {
			doc.suffix = value;
		}
	};
}

/** Runs `mutate` over the body parent, settles its window, and returns the settled change. */
export function settled(
	doc: Document,
	mutate: (parent: BodyParent) => StructuralChange
): StructuralChange {
	const before: CstNode[] = [...doc.children];
	return settleSeparator(settleParentOf(doc), before, mutate(bodyParentOf(doc)));
}

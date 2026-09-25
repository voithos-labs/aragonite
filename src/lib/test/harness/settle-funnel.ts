/**
 * The two steps every top-level structural commit runs, for suites driving the primitives
 * directly: the write against the body parent production hands it, which has no `suffix` field,
 * then the commit's recompute of the document's trailing line. A test calling the write alone
 * hands it a parent production never passes, and proves nothing about the recompute.
 */

import type { CstNode, Document } from '$lib/core/nodes';
import type { BodyParent } from '$lib/tree-operations/node-primitives';
import { type SeparatorParent } from '$lib/tree-operations/node-primitives';
import { settleSeparator } from '$lib/tree-operations/settle';
import type { StructuralChange } from '$lib/tree-operations/structural-change';
import type { GrammarView } from '$lib/schema/block-openers';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { documentLineEnding } from '$lib/core/lines';

/** `editor-actions/block-edit-core.bodyParentOf`: no `suffix` field, by contract. */
const bodyParentOf = (doc: Document): BodyParent => ({
	children: doc.children,
	ownerKind: undefined,
	owner: undefined,
	lineEnding: documentLineEnding(doc)
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

/** Runs `mutate` over the body parent, recomputes the separators around it, returns the change.
 *  `grammar` is the editor's, which the recompute reads blocks with. */
export function settled(
	doc: Document,
	mutate: (parent: BodyParent) => StructuralChange,
	grammar: GrammarView = defaultGrammarView
): StructuralChange {
	const before: CstNode[] = [...doc.children];
	return settleSeparator(settleParentOf(doc), before, mutate(bodyParentOf(doc)), grammar);
}

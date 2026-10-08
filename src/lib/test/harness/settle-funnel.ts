/**
 * The two steps every top-level structural commit runs, for suites driving the primitives
 * directly: the write against the document body, then the commit's recompute of the separators
 * and the document's trailing line. A test calling the write alone proves nothing about the
 * recompute.
 */

import type { CstNode, Document } from '#lib/core/nodes.js';
import { documentBody, type BodyParent } from '#lib/tree-operations/node-primitives.js';
import { settleSeparator } from '#lib/tree-operations/settle.js';
import type { StructuralChange } from '#lib/tree-operations/structural-change.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';

/** Runs `mutate` over the body parent, recomputes the separators around it, returns the change.
 *  `grammar` is the editor's, which the recompute reads blocks with. */
export function settled(
	doc: Document,
	mutate: (parent: BodyParent) => StructuralChange,
	grammar: GrammarView = defaultGrammarView
): StructuralChange {
	const before: CstNode[] = [...doc.children];
	return settleSeparator(
		documentBody(doc),
		before,
		mutate(documentBody(doc)),
		grammar,
		createSharingState()
	);
}

/**
 * G1.55: a top-level container an edit rebuilt reads back, alone, as the tree it holds. A
 * container larger than {@link READ_BACK_LIMIT} is skipped, so a keystroke in a giant one pays
 * no parse.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import type { InvariantViolation } from '../assert';
import type { GrammarView } from '../schema/block-openers';
import { readBlocks } from '../core/parser';
import { describeShapeDivergence } from '../core/shape-divergence';

/** The largest container, in bytes, the check reads. */
export const READ_BACK_LIMIT = 16_384;

let bytesRead = 0;

/** The bytes the check has parsed since the last call, for the test that bounds its cost. */
export function takeReadBackBytes(): number {
	const read = bytesRead;
	bytesRead = 0;
	return read;
}

export function checkReadsBack(node: NodeView, grammar: GrammarView): InvariantViolation | null {
	bytesRead += node.raw.length;
	const read = readBlocks(node.raw, { grammar, scope: 'fragment' });
	const divergence = describeShapeDivergence({ children: [node] }, read);
	return divergence === null
		? null
		: { code: 'reads-back', message: `${node.kind}'s bytes read as another tree: ${divergence}` };
}

/** The top-level containers within the size bound that hold a node in `touched`. */
export function rebuiltTopContainers(doc: DocumentView, touched: readonly NodeView[]): NodeView[] {
	const wanted = new Set(touched);
	// A container with no bytes at all has nothing for a rebuild to have misspelled.
	return doc.children.filter(
		(top) =>
			top.children !== undefined &&
			top.raw !== '' &&
			top.raw.length <= READ_BACK_LIMIT &&
			holdsAny(top, wanted)
	);
}

function holdsAny(node: NodeView, wanted: ReadonlySet<NodeView>): boolean {
	return wanted.has(node) || (node.children ?? []).some((child) => holdsAny(child, wanted));
}

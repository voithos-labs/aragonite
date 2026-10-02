/**
 * G1.55: a top-level container an edit rebuilt reads back, alone, as the tree it holds. The edit
 * names the containers it rebuilt, so the check costs what the edit touched, never the document;
 * one larger than {@link READ_BACK_LIMIT} is skipped, so a keystroke in a giant one pays no parse.
 */

import type { NodeView } from '../core/node-views';
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
	// A container with no bytes at all has nothing for a rebuild to have misspelled.
	if (node.children === undefined || node.raw === '' || node.raw.length > READ_BACK_LIMIT) {
		return null;
	}
	bytesRead += node.raw.length;
	const read = readBlocks(node.raw, { grammar, scope: 'fragment' });
	const divergence = describeShapeDivergence({ children: [node] }, read);
	return divergence === null
		? null
		: { code: 'reads-back', message: `${node.kind}'s bytes read as another tree: ${divergence}` };
}

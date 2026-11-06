/**
 * G1.55: a top-level block an edit wrote reads back, alone, as the tree the editor holds, empty
 * bytes included; a byte splice's run of blocks reads back together. The edit names what it wrote,
 * so the check costs what the edit touched, never the document; anything larger than
 * {@link READ_BACK_LIMIT} is skipped, so a keystroke in a giant block pays no parse.
 */

import type { NodeView } from '../core/node-views';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import type { GrammarView } from '../schema/block-openers';
import { describeShapeDivergence } from '../core/shape-divergence';
import { readAsOpened } from '../schema/opened-reading';

/** The largest block, in bytes, the check reads. */
export const READ_BACK_LIMIT = 16_384;

let bytesRead = 0;

/** The bytes the check has parsed since the last call, for the test that bounds its cost. */
export function takeReadBackBytes(): number {
	const read = bytesRead;
	bytesRead = 0;
	return read;
}

export function checkReadsBack(node: NodeView, grammar: GrammarView): InvariantViolation | null {
	return checkRunReadsBack([node], grammar);
}

/** Adjacent top-level blocks, read together from the first one's own bytes. */
export function checkRunReadsBack(
	run: readonly NodeView[],
	grammar: GrammarView
): InvariantViolation | null {
	if (run.length === 0) return null;
	const bytes = run.map((node, i) => (i === 0 ? '' : node.leadingTrivia) + node.raw).join('');
	// An emptied document's one paragraph holds no bytes, and a read of none gives no block.
	const emptied = bytes === '' && run.every((node) => !node.children?.length);
	if (emptied || bytes.length > READ_BACK_LIMIT) return null;
	bytesRead += bytes.length;
	const read = readAsOpened(bytes, { grammar, scope: 'fragment' });
	const held = run.map((node, i) => (i === 0 ? { ...node, leadingTrivia: '' } : node));
	const divergence = describeShapeDivergence({ children: held }, read);
	const kinds = run.map((node) => node.kind).join(', ');
	return divergence === null
		? null
		: { code: 'reads-back', message: `${kinds}'s bytes read as another tree: ${divergence}` };
}

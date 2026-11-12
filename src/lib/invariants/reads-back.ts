/**
 * G1.55: a top-level block an edit wrote reads back, alone, as the tree the editor holds, empty
 * bytes included; a byte splice's run of blocks reads back together. The edit names what it wrote,
 * so the check costs what the edit touched, never the document; anything larger than
 * {@link READ_BACK_LIMIT} is skipped, so a keystroke in a giant block pays no parse.
 */

import type { NodeView } from '../core/node-views';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { unfinishedReadings, waitingReading, type GrammarView } from '../schema/block-openers';
import { splitLines } from '../core/lines';
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

/** G1.189: no block an undo or redo puts back reads as itself under `was`, the grammar its entry
 *  was read under, and as another tree under the editor's. One misread under both is G1.55's. */
export function checkRestoredUnderGrammar(
	tops: readonly NodeView[],
	grammar: GrammarView,
	was: GrammarView
): InvariantViolation | null {
	for (const top of tops) {
		const read = checkReadsBack(top, grammar);
		if (read && !checkReadsBack(top, was))
			return { code: 'restore-grammar', message: `an undo put back ${read.message}` };
	}
	return null;
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

/** The runs a byte splice's windows read back as: each with the block on either side, out to the
 *  blank lines where it stands flush against them, and to the far end around a waiting opener. */
export function spliceRuns(
	top: readonly NodeView[],
	windows: readonly { at: number; count: number }[],
	grammar: GrammarView
): NodeView[][] {
	const readings = unfinishedReadings(grammar);
	const closes = (node: NodeView) =>
		splitLines(node.raw).some((line) => readings.some((r) => !r.readsOn && r.mayClose(line.text)));
	return windows.map(({ at, count }) => {
		const run = top.slice(Math.max(at - 1, 0), at + count + 1);
		const waits = run.some((node) => waitingReading(node.raw, readings));
		const from = run.some(closes) ? 0 : Math.max(at - 1, 0);
		const to = waits ? top.length : at + count + 1;
		// Found by blank lines alone, not the splice's own look, so a window cut short shows.
		let above = Math.min(at, top.length - 1);
		while (above > 0 && top[above].leadingTrivia === '') above--;
		let below = at + count;
		while (below < top.length && top[below].leadingTrivia === '') below++;
		const flush = top.slice(Math.min(from, above), Math.max(to, below));
		// A run past the limit is read with its neighbours alone, which the check can afford.
		return bytesIn(flush) > READ_BACK_LIMIT ? top.slice(from, to) : flush;
	});
}

const bytesIn = (run: readonly NodeView[]): number =>
	run.reduce((bytes, node) => bytes + node.leadingTrivia.length + node.raw.length, 0);

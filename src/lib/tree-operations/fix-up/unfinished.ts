// Constructs a line below can finish: an opener the edit left waiting takes in the
// blocks down to its closer, or to the body's end when it reads on; a closer the edit wrote
// finishes the opener above it.
import { splitLines } from '../../core/lines';
import type { CstNode } from '../../core/nodes';
import type { UnfinishedReading } from '../../schema/block-openers';
import type { Host } from './types';
import { bytesOf, readAt } from './reading';
import { replace, type Work } from './work';

const lines = (node: CstNode): string[] => splitLines(node.raw).map((line) => line.text);

/** Re-reads around the blocks `[from, from + count)`: up from them when one of their lines may
 *  close a construct above, else down from any of them (or the block above) left waiting. */
export function rereadUnfinished(work: Work, from: number, count: number, host: Host): void {
	if (!lookUp(work, from, count, host))
		lookDown(work, Math.max(from - 1, 0), from + count, host.readingsThatMayChange(), host);
}

function lookUp(work: Work, from: number, count: number, host: Host): boolean {
	const written = work.blocks.slice(from, from + count).flatMap(lines);
	const top = host.waitingAboveClosedBy(written, (i) => work.blocks.at(i).raw, from);
	return top >= 0 && reread(work, top, from + count - 1, host) !== null;
}

function lookDown(
	work: Work,
	from: number,
	to: number,
	readings: readonly UnfinishedReading[],
	host: Host
): void {
	for (let i = from; i < to && i < work.blocks.length; i++) {
		const waiting = readings.filter((reading) => reading.notFinal(work.blocks.at(i).raw));
		if (waiting.length === 0) continue;
		let toEnd = false;
		const closes = (k: number) =>
			lines(work.blocks.at(k)).some((line) => waiting.some((r) => r.mayClose(line)));
		let last: number | null = null;
		// A candidate the opener refuses reads the same: try the next one down.
		for (let end = i + 1; ; end++) {
			while (end < work.blocks.length && !closes(end)) end++;
			if (end === work.blocks.length && !waiting.some((reading) => reading.readsOn)) break;
			toEnd = end >= work.blocks.length - 1;
			last = reread(work, i, Math.min(end, work.blocks.length - 1), host);
			if (last !== null || toEnd) break;
		}
		if (last === null) continue;
		// A re-read can leave its last block waiting again: walk on from there, unless it read on to
		// the body's end, which leaves nothing below to take in.
		if (toEnd) return;
		to = Math.max(to, last + 1);
		i = last - 1;
	}
}

/** Reads `blocks[lo, hi]` again as one text (with the body's trailing lines when `hi` is last);
 *  when that reads otherwise, it takes their place. Returns the index of the last block read. */
function reread(work: Work, lo: number, hi: number, host: Host): number | null {
	const { blocks } = work;
	// A block with no reading of its own (a table cell) is never read again.
	if (blocks.slice(lo, hi + 1).some((node) => host.kindTraits(node.kind).contextDependent))
		return null;
	const atEnd = hi === blocks.length - 1;
	const read = readAt(
		host,
		work.list.owner,
		lo,
		bytesOf(blocks, lo, hi) + (atEnd ? work.trailing : '')
	);
	const next = read.children;
	const same =
		next.length === hi - lo + 1 &&
		next.every(
			(node, k) => node.kind === blocks.at(lo + k).kind && node.raw === blocks.at(lo + k).raw
		);
	if (same || next.length === 0) return null;
	next[0] = { ...next[0], leadingTrivia: blocks.at(lo).leadingTrivia + read.prefix };
	if (atEnd) work.trailing = read.suffix;
	replace(work, lo, hi, next);
	return lo + next.length - 1;
}

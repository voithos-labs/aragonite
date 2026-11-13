// Constructs a line below can finish: an opener the edit left waiting takes in the
// blocks down to its closer, or to the body's end when it reads on; a closer the edit wrote
// finishes the opener above it. A wait no line closes (a definition's, on its title) is read
// from the block that waits down to where the wait ends.
import { ownTrailingLineEnding, splitLines } from '../../core/lines';
import type { CstNode } from '../../core/nodes';
import type { BytesView } from '../../core/node-views';
import type { UnfinishedReading } from '../../schema/block-openers';
import type { JoinBlock } from './joins';
import type { Caret, Host, ListResult, SiblingList } from './types';
import { bodyStart, bytesOf, isBlankBlock, readAt } from './reading';
import { finish, replace, startWork, type Work } from './work';

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
		// A wait no line closes is `settleWaits`'s, which reads as far as it runs and no further.
		const waiting = readings.flatMap((reading) =>
			reading.closer !== null && reading.notFinal(work.blocks.at(i).raw) ? [reading] : []
		);
		if (waiting.length === 0) continue;
		let toEnd = false;
		const closes = (k: number) =>
			lines(work.blocks.at(k)).some((line) => waiting.some((r) => r.mayClose(line)));
		let last: number | null = null;
		// A candidate the opener refuses reads the same: try the next one down.
		for (let end = i + 1; ; end++) {
			while (end < work.blocks.length && !closes(end)) end++;
			if (end === work.blocks.length && !waiting.some((r) => r.readsOn)) break;
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

/** Re-reads the blocks a wait no line closes reaches at the joins `from` to `to`, join `j` lying
 *  between blocks `j - 1` and `j`, where they read otherwise than they stand. */
export function settleWaits(work: Work, from: number, to: number, host: Host): void {
	eachWait(work, from, to, host, ({ lo, hi, next, trailing }) => {
		if (trailing !== undefined) work.trailing = trailing;
		replace(work, lo, hi, next);
	});
}

/** Gives a blank line to each join from `from` to `to` where a wait would read the blocks
 *  otherwise than they stand: the wait ends there, and both readings stay. */
export function partWaits(work: Work, from: number, to: number, host: Host): void {
	eachWait(work, from, to, host, (_, j) => {
		const ending = ownTrailingLineEnding(work.blocks.at(j - 1).raw) || work.list.lineEnding;
		work.blocks.set(j, { ...work.blocks.at(j), leadingTrivia: ending });
		return 'parted';
	});
}

/** Whether a wait from above would read `pair`, touching in place of blocks `index` to `last`,
 *  otherwise than it stands: a removal that leaves it so parts it, as a move does. */
export function waitTakesPair(
	list: BytesView<SiblingList>,
	index: number,
	last: number,
	pair: readonly [JoinBlock, JoinBlock],
	host: Host
): boolean {
	// The look only reads, so a view of the list stands in for its nodes.
	const work = startWork(list as SiblingList, {});
	const upper = { ...pair[0], leadingTrivia: list.children[index].leadingTrivia } as CstNode;
	work.blocks.splice(index, last - index + 1, [upper, pair[1] as CstNode], [index, last]);
	const reading = waitReading(work, index + 1, bodyStart(work, host), host);
	// A wait the upper opens itself is the pair's own question, which the join asks.
	return !!reading?.next && reading.lo < index;
}

/** {@link settleWaits} at the one join above block `at`, for a container there that took new
 *  bytes with no fix-up of its list to follow. */
export function settleWaitAt(list: SiblingList, at: number, host: Host, caret?: Caret): ListResult {
	const work = startWork(list, caret ? { caret } : {});
	settleWaits(work, at, at, host);
	return finish(work);
}

type WaitReading = { lo: number; hi: number; next: CstNode[]; trailing?: string };

function eachWait(
	work: Work,
	from: number,
	to: number,
	host: Host,
	settle: (reading: WaitReading, j: number) => 'parted' | void
): void {
	let floor = bodyStart(work, host);
	for (let j = Math.max(from, floor + 1); j <= to && j < work.blocks.length; j++) {
		const reading = waitReading(work, j, floor, host);
		// One walk up the list an edit: past this join only the block right above one can newly wait.
		floor = j;
		if (!reading) continue;
		const { lo, hi, next } = reading;
		// A parted join ends the wait where it stands; the blocks under it are asked in turn.
		if (next && settle({ ...reading, next }, j) === 'parted') continue;
		if (next) to += next.length - (hi - lo + 1);
		// The read settled every join down to its last block.
		j = floor = lo + (next ? next.length : hi - lo + 1) - 1;
	}
}

/** What a wait open at join `j` makes of `[lo, hi]`, the block that waits down to the wait's end:
 *  `next`, null there when they read as they stand. Null when no block from `floor` down waits. */
function waitReading(
	work: Work,
	j: number,
	floor: number,
	host: Host
): { lo: number; hi: number; next: CstNode[] | null; trailing?: string } | null {
	const { blocks } = work;
	const last = blocks.length - 1;
	const block = (i: number) => blocks.at(i);
	const lo = host.waitingInto(block, j, floor);
	if (lo < 0) return null;
	for (let hi = j, grow = 1; ; grow *= 2) {
		// A block with no reading of its own (a table cell) is never read again.
		if (blocks.slice(lo, hi + 1).some((node) => host.kindTraits(node.kind).contextDependent))
			return null;
		const head = bytesOf(blocks, lo, hi);
		const under = hi < last ? block(hi + 1) : undefined;
		// A blank line ends every wait, so a read that stops at one looks at nothing below it.
		const flush = !!under && under.leadingTrivia === '' && !isBlankBlock(under);
		const line = flush ? under.raw.slice(0, under.raw.indexOf('\n') + 1 || under.raw.length) : '';
		const read = readAt(host, work.list.owner, lo, head + (under ? line : work.trailing));
		const next = read.children;
		if (next.length === 0) return null;
		let m = next.length;
		if (flush) {
			let at = read.prefix.length;
			for (m = 0; m < next.length && at < head.length; m++)
				at += next[m].leadingTrivia.length + next[m].raw.length;
			// The line under the read has to stand as a block of its own, where it stood.
			if (at !== head.length || next.length !== m + 1 || next[m].leadingTrivia !== '') {
				hi = Math.min(last, hi + grow);
				continue;
			}
			const runsTo = host.waitRunsPast(next, block, hi + 1, last);
			if (runsTo >= 0) {
				hi = runsTo;
				continue;
			}
		}
		const kept = next.slice(0, m);
		kept[0] = { ...kept[0], leadingTrivia: block(lo).leadingTrivia + read.prefix };
		// A leaf holds a blank line its reading leaves below it as its own.
		const tail = kept[m - 1];
		if (under && !flush && read.suffix !== '' && !tail.children)
			kept[m - 1] = { ...tail, raw: tail.raw + read.suffix };
		const same =
			m === hi - lo + 1 &&
			kept.every((node, k) => node.kind === block(lo + k).kind && node.raw === block(lo + k).raw);
		if (same) return { lo, hi, next: null };
		return { lo, hi, next: kept, ...(under ? {} : { trailing: read.suffix }) };
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

// Neighbours whose joined bytes read as one block become that block.
import type { CstNode } from '../../core/nodes';
import type { SiblingList, Caret, Host, ListResult } from './types';
import { bytesOf, isBlankBlock, prime, readAt, readsOn } from './reading';
import { finish, replace, startWork, type Work } from './work';

export function mergeJoins(
	list: SiblingList,
	at: number,
	added: number,
	host: Host,
	caret?: Caret
): ListResult {
	prime(host);
	const work = startWork(list, caret ? { caret } : {});
	mergeAcross(work, at, at + added, host);
	return finish(work);
}

/** Merges across the joins `from` to `to`, join `j` lying between blocks `j - 1` and `j`. */
export function mergeAcross(work: Work, from: number, to: number, host: Host): void {
	for (let j = Math.max(from, 1); j <= to && j < work.blocks.length; j++) {
		const merge = mergeAt(work, j, host);
		if (!merge) continue;
		const lost = merge.hi - merge.lo + 1 - merge.count;
		to = Math.max(to - lost, merge.lo + merge.count);
		j = merge.lo + merge.count - 1;
	}
}

/** Re-reads the window around join `j`, grown past blank blocks, and replaces it when it reads as
 *  fewer blocks, or as as many with content moved into the upper one. */
function mergeAt(
	work: Work,
	j: number,
	host: Host
): { lo: number; hi: number; count: number } | null {
	const { blocks } = work;
	const owner = work.list.owner;
	let lo = j - 1;
	let hi = j;
	while (lo > 0 && isBlankBlock(blocks.at(lo))) lo--;
	while (hi < blocks.length - 1 && isBlankBlock(blocks.at(hi))) hi++;
	const window = blocks.slice(lo, hi + 1);
	if (
		window.some((node) => host.kindTraits(node.kind).contextDependent) ||
		readsOn(host, blocks.at(lo))
	)
		return null;
	if (hi === lo + 1 && headLineRefuses(work, lo, host)) return null;
	const text = bytesOf(blocks, lo, hi);
	const read = readAt(host, owner, lo, text);
	let next = read.children;
	if (next.length === 0 || content(next) > content(window)) return null;
	// As many blocks or more is still a merge when the upper block took content in.
	if (next.length >= window.length && next[0].raw.length <= window[0].raw.length) return null;
	if (readAt(host, owner, lo, blocks.at(lo).raw).children[0]?.kind !== blocks.at(lo).kind)
		return null;
	// Blank lines at the merged lower edge read together with the follower's, as a reload reads them.
	const follower = blocks.at(hi + 1);
	const endsBlank = read.suffix !== '' || isBlankBlock(next[next.length - 1]);
	const edge =
		follower && endsBlank && (read.suffix !== '' || follower.leadingTrivia !== '')
			? readAt(host, owner, lo, text + follower.leadingTrivia)
			: null;
	if (edge) next = edge.children;
	next[0] = { ...next[0], leadingTrivia: blocks.at(lo).leadingTrivia + read.prefix };
	// A leaf holds a blank line its reading leaves below it as its own.
	const last = next[next.length - 1];
	if (!edge && read.suffix !== '' && !last.children)
		next[next.length - 1] = { ...last, raw: last.raw + read.suffix };
	else if (!edge && read.suffix !== '') work.trailing = read.suffix + work.trailing;
	replace(work, lo, hi, next);
	const below = lo + next.length;
	if (edge && follower.leadingTrivia !== edge.suffix)
		work.blocks.set(below, { ...follower, leadingTrivia: edge.suffix });
	return { lo, hi, count: next.length };
}

/** A cheap refusal: the upper block read with the lower's first line alone reads as two blocks, and
 *  nothing below can change that while the upper is a finished leaf, or the two touch. */
function headLineRefuses(work: Work, lo: number, host: Host): boolean {
	const upper = work.blocks.at(lo);
	const lower = work.blocks.at(lo + 1);
	// Asked of the kind, so a neighbour's children are never read.
	if (lower.leadingTrivia !== '' && host.kindTraits(upper.kind).container) return false;
	if (host.readingsThatMayChange().some((reading) => reading.notFinal(upper.raw))) return false;
	const line = lower.raw.slice(0, lower.raw.indexOf('\n') + 1) || lower.raw;
	return (
		readAt(host, work.list.owner, lo, upper.raw + lower.leadingTrivia + line).children.length >= 2
	);
}

const content = (blocks: readonly CstNode[]) => blocks.filter((node) => !isBlankBlock(node)).length;

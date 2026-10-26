// Runs of blank lines held where a reload holds them, and the lines a blank block the edit filled
// or took away gives back to the blocks beside it.
import { endsInBlankLine, ownTrailingLineEnding } from '../../core/lines';
import type { CstNode } from '../../core/nodes';
import type { Host, ListEdit } from './types';
import { bodyStart, isBlankBlock, ownsBlankLine, readAt } from './reading';
import type { Work } from './work';

type Edge = 'content' | 'fence' | 'none';

/** Lays out the blank lines at join `j` (above block `j`) as a reload reads them, dropping extra
 *  hidden lines and writing missing ones; with `atLeast`, holding that many where none are needed. */
export function layOutRun(
	work: Work,
	j: number,
	host: Host,
	atLeast = 0,
	ending: string = work.list.lineEnding
): void {
	const { blocks } = work;
	const start = bodyStart(work, host);
	let lo = j - 1;
	let hi = j;
	while (lo >= start && isBlankBlock(blocks.at(lo))) lo--;
	while (hi < blocks.length && isBlankBlock(blocks.at(hi))) hi++;
	const upper = lo >= start ? blocks.at(lo) : undefined;
	// Two blocks with at most one line between them already read as a reload reads them.
	if (
		upper &&
		hi === lo + 1 &&
		hi < blocks.length &&
		atLeast === 0 &&
		!endsInBlankLine(upper.raw)
	) {
		if (!/\n[^]/.test(blocks.at(hi).leadingTrivia)) return;
	}
	const wrap = work.list.owner && host.kindTraits(work.list.owner.kind).bodyWrap;
	const above: Edge = upper ? 'content' : wrap?.afterOpenerLine ? 'fence' : 'none';
	const below: Edge = hi < blocks.length ? 'content' : wrap?.beforeCloserLine ? 'fence' : 'none';
	const own = upper && ownsBlankLine(host, work.list.owner, lo, upper) ? 1 : 0;
	const trailing = below === 'content' ? [] : lines(work.trailing);
	const held = [above === 'fence' ? work.leading : ''];
	for (let i = lo + 1; i <= hi && i < blocks.length; i++) held.push(blocks.at(i).leadingTrivia);
	let pool = [...lines(held.join('')), ...trailing];
	while (pool.length < atLeast) pool.push(ending);
	let count = hi - lo - 1;
	let hidden = hiddenCount(pool.length, count, own, above, below);
	// The body's own trailing lines a reload reads as blocks become blank blocks.
	let appended: string[] = [];
	const excess = pool.length - hidden;
	if (excess > 0 && trailing.length > 0 && below === 'none' && (count > 0 || above === 'none')) {
		appended = trailing.slice(Math.max(trailing.length - excess, 0));
		pool = pool.slice(0, pool.length - appended.length);
		count += appended.length;
		hidden = hiddenCount(pool.length, count, own, above, below);
	}
	const layout = readRun(own + hidden + count, above, below);
	const slots: ('prefix' | 'separator' | 'suffix')[] = [];
	if (layout.prefix) slots.push('prefix');
	if (layout.separator) slots.push(count > 0 || below === 'content' ? 'separator' : 'suffix');
	if (layout.suffix) slots.push('suffix');
	const kept = { prefix: '', separator: '', suffix: '' };
	slots.slice(own).forEach((slot, i) => (kept[slot] += pool[i] ?? ending));
	if (above === 'fence') work.leading = kept.prefix;
	for (const line of appended) blocks.push({ kind: 'paragraph', leadingTrivia: '', raw: line });
	for (let i = lo + 1; i <= hi && i < blocks.length; i++) {
		const trivia = i === lo + 1 ? kept.separator : '';
		if (blocks.at(i).leadingTrivia !== trivia)
			blocks.set(i, { ...blocks.at(i), leadingTrivia: trivia });
	}
	if (below !== 'content') work.trailing = kept.suffix;
}

/** How a reload reads `total` blank lines between two edges: the line each fence line takes while
 *  the body keeps another, the separator under a block above, and the blank blocks the rest are. */
function readRun(total: number, above: Edge, below: Edge) {
	const bodyLines = above === 'content' || below === 'content' ? Infinity : total;
	let rest = total;
	const prefix = above === 'fence' && rest > 0 && bodyLines >= 2;
	if (prefix) rest--;
	const suffix = below === 'fence' && rest > 0 && bodyLines - Number(prefix) >= 2;
	if (suffix) rest--;
	const separator = above === 'content' && rest > 0;
	if (separator) rest--;
	return { prefix, separator, suffix, blocks: rest };
}

/** The hidden lines a run of `count` blank blocks keeps: of the counts a reload reads as exactly
 *  those blocks, the nearest to the `held` it holds, at most one past the fewest. */
function hiddenCount(held: number, count: number, own: number, above: Edge, below: Edge): number {
	const fits = [0, 1, 2, 3].filter(
		(hidden) => readRun(own + hidden + count, above, below).blocks === count
	);
	if (fits.length === 0) return held;
	return Math.min(Math.max(held, fits[0]), fits[fits.length - 1], fits[0] + 1);
}

const lines = (text: string): string[] => text.match(/[^\n]*\n/g) ?? [];

/** The block that takes a removed block's place takes its blank lines when it has none; a write
 *  that filled or took away blank blocks gives its first block the line above them back. */
export function takeRemovedLines(work: Work, edit: ListEdit, at: number): void {
	const { before, span } = edit;
	const node = work.blocks.at(at);
	if (!node || node.leadingTrivia !== '' || edit.moved) return;
	const added = span ? span.added : 1;
	const taken = blanksTaken(work, edit, at, added).filter(isBlankBlock);
	// The block that stood at `at` before the edit hands its line down when the edit put another there.
	const vacated =
		before && span && before[at] && !work.blocks.slice(at, at + added).includes(before[at]);
	let trivia = vacated ? before[at].leadingTrivia : '';
	const above = work.blocks.at(at - 1);
	if (added > 0 && taken.length > 0 && at > 0 && !isBlankBlock(above)) {
		trivia =
			ownTrailingLineEnding(taken[0].leadingTrivia) ||
			ownTrailingLineEnding(above.raw) ||
			work.list.lineEnding;
	}
	if (trivia !== '') work.blocks.set(at, { ...node, leadingTrivia: trivia });
}

/** The join whose lower block gets back the line a blank block the edit filled, took away or
 *  lifted out from under a block served it, with that line's ending. */
export function lineGivenBack(
	work: Work,
	edit: ListEdit,
	from: number,
	count: number,
	host: Host
): [number, string] | null {
	const { moved, span, before, written } = edit;
	const has = (j: number) => j < work.blocks.length && !isBlankBlock(work.blocks.at(j - 1));
	if (moved && span && before) {
		const lifted = !isBlankBlock(before[span.at]) && isBlankBlock(before[span.at + 1]);
		return lifted && has(span.at + 2) ? [span.at + 2, work.list.lineEnding] : null;
	}
	const gone = blanksTaken(work, edit, from, count);
	const ending = ownTrailingLineEnding(gone[gone.length - 1]?.raw ?? '') || work.list.lineEnding;
	if (gone.length > 0 && has(from + count)) return [from + count, ending];
	// A leaf the write took its own trailing blank line from leaves the gap below one line short.
	const owner = work.list.owner;
	const last = from + count - 1;
	const gaveUp =
		written &&
		ownsBlankLine(host, owner, from, written.previous) &&
		!ownsBlankLine(host, owner, last, work.blocks.at(last));
	return gaveUp && has(from + count) ? [from + count, work.list.lineEnding] : null;
}

/** A blank tail under a closing fence line borrows a line the fence takes on reload; a filled or
 *  removed tail gives it back, since a line written there reads the same. */
export function returnFenceLine(
	work: Work,
	edit: ListEdit,
	from: number,
	count: number,
	host: Host
): void {
	const owner = work.list.owner;
	const last = work.blocks.length - 1;
	if (
		!owner ||
		work.trailing === '' ||
		from + count - 1 < last ||
		isBlankBlock(work.blocks.at(last))
	)
		return;
	if (!host.kindTraits(owner.kind).bodyWrap?.beforeCloserLine) return;
	if (blanksTaken(work, edit, from, count).length > 0) work.trailing = '';
}

/** The blocks the edit removed (or wrote over), when they held more blank blocks than it placed
 *  at `[from, from + count)`. */
function blanksTaken(work: Work, edit: ListEdit, from: number, count: number): CstNode[] {
	const { span, before, written } = edit;
	const gone =
		before && span
			? before.slice(span.at, span.at + span.removed)
			: written
				? [written.previous]
				: [];
	const placedBlanks = work.blocks.slice(from, from + count).filter(isBlankBlock).length;
	return gone.filter(isBlankBlock).length > placedBlanks ? gone : [];
}

/** An unended blank last line its block's reading leaves out is the body's trailing line. */
export function releaseOpenBlankLine(work: Work, host: Host): void {
	const last = work.blocks.length - 1;
	const node = work.blocks.at(last);
	if (
		!node ||
		node.children ||
		ownTrailingLineEnding(node.raw) !== '' ||
		!endsInBlankLine(node.raw)
	)
		return;
	const { suffix } = readAt(host, work.list.owner, last, node.raw);
	if (suffix === '' || !node.raw.endsWith(suffix)) return;
	work.blocks.set(last, { ...node, raw: node.raw.slice(0, -suffix.length) });
	work.trailing = suffix + work.trailing;
}

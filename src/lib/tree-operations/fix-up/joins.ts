// How two touching blocks read flush against each other, and the blank line a join gets for it.
import { ownTrailingLineEnding } from '../../core/lines';
import type { CstNode } from '../../core/nodes';
import type { Host, ListEdit } from './types';
import { isBlankBlock, ownsBlankLine, readAt } from './reading';
import type { Work } from './work';

/** A join beside a block the edit placed keeps both readings; a join beside a block it rewrote
 *  or a pair it uncovered folds where it reads as one, but keeps each block's kind; a typed
 *  write reads the way its bytes do. */
export type Role = 'placed' | 'rewritten' | 'written';

type Reading = 'stands' | 'folds' | 'separate' | 'merge';

/** Gives join `j` (between blocks `j - 1` and `j`) the blank line its reading asks for. */
export function partJoin(work: Work, j: number, role: Role, host: Host, typed: boolean): void {
	const upper = work.blocks.at(j - 1);
	const lower = work.blocks.at(j);
	if (
		!upper ||
		!lower ||
		lower.leadingTrivia !== '' ||
		ownsBlankLine(host, work.list.owner, j - 1, upper)
	)
		return;
	if (isBlankBlock(upper) || isBlankBlock(lower)) return;
	if ([upper, lower].some((node) => host.kindTraits(node.kind).contextDependent)) return;
	const tableRow = host.kindTraits(upper.kind).grid && host.continuesTableAbove(lower.raw);
	// A list that can't interrupt the paragraph above (its first item is empty) keeps a line under
	// it; a typed write wrote that line itself.
	const emptyItem =
		!typed &&
		upper.kind === 'paragraph' &&
		lower.kind === 'list' &&
		!interrupts(work, j, upper, lower, host);
	// A typed write parts nothing else, so it reads nothing more.
	if (role === 'written' && !tableRow && !emptyItem) return;
	const reading = tableRow || emptyItem ? null : readJoin(work, j, upper, lower, host);
	if (
		tableRow ||
		emptyItem ||
		(reading === 'separate' && role !== 'written') ||
		(reading === 'folds' && role === 'placed')
	) {
		work.blocks.set(j, {
			...lower,
			leadingTrivia: ownTrailingLineEnding(upper.raw) || work.list.lineEnding
		});
	}
}

/** Whether the first line of `lower` opens a block of its own flush under `upper`. */
function interrupts(work: Work, j: number, upper: CstNode, lower: CstNode, host: Host): boolean {
	const line = lower.raw.slice(0, lower.raw.indexOf('\n') + 1) || lower.raw;
	return readAt(host, work.list.owner, j - 1, upper.raw + line).children.length > 1;
}

function readJoin(
	work: Work,
	j: number,
	upper: CstNode,
	lower: CstNode,
	host: Host
): Reading | null {
	const owner = work.list.owner;
	const read = (text: string) => readAt(host, owner, j - 1, text).children;
	// A container's child never reads as itself alone, so its joins are its container's to read.
	if (read(upper.raw)[0]?.kind !== upper.kind) return null;
	const flush = read(upper.raw + lower.raw);
	const [first, second] = flush;
	if (
		flush.length === 2 &&
		first.kind === upper.kind &&
		first.raw === upper.raw &&
		second.kind === lower.kind
	)
		return 'stands';
	const parted = upper.raw + (ownTrailingLineEnding(upper.raw) || work.list.lineEnding);
	const apart = read(parted + lower.raw);
	// No blank line parts them: they read as one, or the upper still takes content in.
	if (apart.filter((node) => !isBlankBlock(node)).length < 2 || apart[0].raw.length > parted.length)
		return 'merge';
	return flush.length === 1 && first.kind === upper.kind && foldsAsItself(first, lower)
		? 'folds'
		: 'separate';
}

/** The lower block reads on inside `merged`: as prose, or as one more of its kind. */
const foldsAsItself = (merged: CstNode, lower: CstNode): boolean =>
	lower.kind === 'paragraph' || lower.kind === merged.kind;

/** A list made from one block loses the blank lines to a same-type list beside it, so the two read
 *  as one, except on a side the replaced block already continued, or after text read as several. */
export function joinSameLists(
	work: Work,
	edit: ListEdit,
	at: number,
	count: number,
	host: Host
): void {
	const { written, span, before } = edit;
	const replaced = written?.previous ?? (span?.removed === 1 ? before?.[span.at] : undefined);
	if (!replaced || edit.moved || count < 1 || (count > 1 && !isBlankBlock(replaced))) return;
	const top = work.blocks.at(at);
	const above = work.blocks.at(at - 1);
	if (above && sameType(above, top, host) && !sameType(above, replaced, host))
		work.blocks.set(at, { ...top, leadingTrivia: '' });
	const below = work.blocks.at(at + count);
	if (
		below &&
		sameType(work.blocks.at(at + count - 1), below, host) &&
		!sameType(replaced, below, host)
	) {
		work.blocks.set(at + count, { ...below, leadingTrivia: '' });
	}
}

const sameType = (upper: CstNode | undefined, lower: CstNode | undefined, host: Host): boolean =>
	upper?.kind === 'list' && lower?.kind === 'list' && host.listsContinue(upper, lower);

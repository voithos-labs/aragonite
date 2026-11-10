/**
 * One read of a document for a range edit, and the questions every gesture asks of it: which block
 * a byte sits in, which containers hold it, where a title row is.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { firstLineEnding, ownTrailingLineEnding, type LineEnding } from '../core/lines';
import type { BlockFacts } from '../schema/block-facts';
import { blockNodeAt } from '../tree-operations/node-primitives';
import type { Mode, RangeHost } from './host';
import type { LaidBlock, LaidLine, Layout } from './layout';

export interface Doc {
	source: string;
	tree: DocumentView;
	layout: Layout;
	host: RangeHost;
	mode: Mode;
	/** The line ending a new line takes: the first the gesture's source held before any byte of it
	 *  changed, `\n` where it held none, as pasted text arrives. */
	ending: LineEnding;
	/** The range names blocks the editor was asked to remove whole, not text: a paragraph goes too,
	 *  and a block ending its parent takes the separator above it. */
	wholeBlocks?: boolean;
}

export function readDoc(source: string, host: RangeHost, mode: Mode): Doc {
	const tree = host.read(source);
	return {
		source,
		tree,
		layout: host.layout(tree),
		host,
		mode,
		ending: firstLineEnding(source) ?? '\n'
	};
}

export const factsOf = (doc: Doc, block: LaidBlock): BlockFacts => doc.host.facts(block.type);

/** The first block reaching `[from, to]` that `matches`, parents before children. */
export function findWithin(
	doc: Doc,
	from: number,
	to: number,
	matches: (block: LaidBlock) => boolean
): LaidBlock | undefined {
	for (const block of doc.layout.within(from, to)) if (matches(block)) return block;
	return undefined;
}

export const nodeAt = (doc: Doc, path: readonly number[]): NodeView => blockNodeAt(doc.tree, path)!;

export const parentOf = (doc: Doc, block: LaidBlock): LaidBlock | undefined =>
	doc.layout.block(block.path.slice(0, -1));

/** Where a block's last line ends, before its line ending. */
export const contentEnd = (doc: Doc, block: LaidBlock) =>
	block.to - ownTrailingLineEnding(doc.source.slice(block.from, block.to)).length;

/** The text block whose text holds `byte`, with the offset into its bytes. */
export function leafAt(doc: Doc, byte: number): { leaf: LaidBlock; offset: number } | null {
	const point = doc.layout.pointAt(byte);
	const leaf = point && doc.layout.block(point.path);
	if (!leaf?.text || byte < leaf.text.from || byte > leaf.text.to) return null;
	// A hidden body maps every offset to one byte, where no place in the text is; an empty text's
	// one place is that byte.
	const before = point!.offset > 0 ? doc.layout.byteOf(leaf.path, point!.offset - 1) : -1;
	const empty = leaf.text.from === leaf.text.to && leaf.from < leaf.to;
	return empty || (before !== null && before < byte) ? { leaf, offset: point!.offset } : null;
}

/** The text block whose text holds both `from` and `to`, with their offsets into its bytes. */
export function leafHolding(doc: Doc, from: number, to: number) {
	const head = leafAt(doc, from);
	const tail = from === to ? head : leafAt(doc, to);
	return head && head.leaf === tail?.leaf
		? { leaf: head.leaf, from: head.offset, to: tail.offset }
		: null;
}

/** Whether `leaf` is a table cell, which holds one line. */
export function isCell(doc: Doc, leaf: LaidBlock): boolean {
	const row = parentOf(doc, leaf);
	return !!row && factsOf(doc, row).lines === 'cells';
}

/** The block a byte's text position names, in its text or past it. */
export function pointedBlock(doc: Doc, byte: number): LaidBlock | undefined {
	const point = doc.layout.pointAt(byte);
	return point ? doc.layout.block(point.path) : undefined;
}

/** The containers whose bytes hold `byte`, outermost first; at a container's last byte only the
 *  `end` side counts it. */
export function containersAt(doc: Doc, byte: number, side: 'start' | 'end'): LaidBlock[] {
	return [...doc.layout.within(byte, byte)].filter(
		(b) =>
			b.container &&
			(side === 'start' ? b.from <= byte && byte < b.to : b.from < byte && byte <= b.to)
	);
}

/** The containers a caret at `at` sits in; a container's last byte counts where no line ending
 *  closes it (the document's last line). */
export function containersHolding(doc: Doc, at: number): LaidBlock[] {
	return [...doc.layout.within(at, at)].filter(
		(b) =>
			b.container &&
			b.from <= at &&
			(at < b.to || (at === b.to && !doc.source.endsWith('\n', b.to)))
	);
}

/** The container's line holding `byte`, or its last. */
export function lineOf(container: LaidBlock, byte: number): LaidLine {
	const lines = container.lines!;
	let lo = 0;
	let hi = lines.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (byte < lines[mid].to) hi = mid;
		else lo = mid + 1;
	}
	return lines[lo];
}

export const firstBodyLine = (container: LaidBlock) => container.lines!.find((l) => !l.own);

/** The block that is a container's title row, when it has one. */
export function titleRowOf(doc: Doc, container: LaidBlock): LaidBlock | undefined {
	const type = factsOf(doc, container).titleRow?.type;
	if (type === undefined) return undefined;
	const count = nodeAt(doc, container.path).children?.length ?? 0;
	for (let i = 0; i < count; i++) {
		const child = doc.layout.block([...container.path, i]);
		if (child?.type === type) return child;
	}
	return undefined;
}

/** The title row whose line holds `byte`, when one does. */
export function titleAt(doc: Doc, byte: number): LaidBlock | undefined {
	for (const owner of doc.layout.within(byte, byte)) {
		const row = owner.container && titleRowOf(doc, owner);
		if (!row) continue;
		const end = doc.source.indexOf('\n', row.from);
		if (row.from <= byte && byte <= (end < 0 ? doc.source.length : end)) return row;
	}
	return undefined;
}

/** The container whose title row is `leaf`, when it is one. */
export function titleOwner(doc: Doc, leaf: LaidBlock): LaidBlock | undefined {
	const parent = parentOf(doc, leaf);
	return parent && factsOf(doc, parent).titleRow?.type === leaf.type ? parent : undefined;
}

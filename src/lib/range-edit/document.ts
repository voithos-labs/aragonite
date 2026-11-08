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
	byPath: Map<string, LaidBlock>;
}

export function readDoc(source: string, host: RangeHost, mode: Mode): Doc {
	const tree = host.read(source);
	const layout = host.layout(tree);
	const byPath = new Map(layout.blocks.map((b) => [b.path.join(), b]));
	return { source, tree, layout, host, mode, byPath };
}

export const factsOf = (doc: Doc, block: LaidBlock): BlockFacts => doc.host.facts(block.type);

export const nodeAt = (doc: Doc, path: readonly number[]): NodeView => blockNodeAt(doc.tree, path)!;

export const parentOf = (doc: Doc, block: LaidBlock): LaidBlock | undefined =>
	doc.byPath.get(block.path.slice(0, -1).join());

/** Where a block's last line ends, before its line ending. */
export const contentEnd = (doc: Doc, block: LaidBlock) =>
	block.to - ownTrailingLineEnding(doc.source.slice(block.from, block.to)).length;

/** The document's line ending, its first; `\n` where it has none, as pasted text arrives. */
export const endingOf = (source: string): LineEnding => firstLineEnding(source) ?? '\n';

/** The text block whose text holds `byte`, with the offset into its bytes. */
export function leafAt(doc: Doc, byte: number): { leaf: LaidBlock; offset: number } | null {
	const point = doc.layout.pointAt(byte);
	const leaf = point && doc.byPath.get(point.path.join());
	if (!leaf?.text || byte < leaf.text.from || byte > leaf.text.to) return null;
	// A hidden body maps every offset to one byte, where no place in the text is; an empty text's
	// one place is that byte.
	const before = point!.offset > 0 ? doc.layout.byteOf(leaf.path, point!.offset - 1) : -1;
	const empty = leaf.text.from === leaf.text.to && leaf.from < leaf.to;
	return empty || (before !== null && before < byte) ? { leaf, offset: point!.offset } : null;
}

/** The block a byte's text position names, in its text or past it. */
export function pointedBlock(doc: Doc, byte: number): LaidBlock | undefined {
	const point = doc.layout.pointAt(byte);
	return point ? doc.byPath.get(point.path.join()) : undefined;
}

/** The containers whose bytes hold `byte`, outermost first; at a container's last byte only the
 *  `end` side counts it. */
export function containersAt(doc: Doc, byte: number, side: 'start' | 'end'): LaidBlock[] {
	return doc.layout.blocks.filter(
		(b) =>
			b.lines !== undefined &&
			(side === 'start' ? b.from <= byte && byte < b.to : b.from < byte && byte <= b.to)
	);
}

/** The containers a caret at `at` sits in; a container's last byte counts where no line ending
 *  closes it (the document's last line). */
export function containersHolding(doc: Doc, at: number): LaidBlock[] {
	return doc.layout.blocks.filter(
		(b) =>
			b.lines !== undefined &&
			b.from <= at &&
			(at < b.to || (at === b.to && !doc.source.endsWith('\n', b.to)))
	);
}

export const lineOf = (container: LaidBlock, byte: number): LaidLine =>
	container.lines!.find((l) => l.from <= byte && byte < l.to) ?? container.lines!.at(-1)!;

export const firstBodyLine = (container: LaidBlock) => container.lines!.find((l) => !l.own);

/** The block that is a container's title row, when it has one. */
export function titleRowOf(doc: Doc, container: LaidBlock): LaidBlock | undefined {
	const type = factsOf(doc, container).titleRow?.type;
	return type === undefined
		? undefined
		: doc.layout.blocks.find((b) => b.type === type && parentOf(doc, b) === container);
}

/** The title row whose line holds `byte`, when one does. */
export function titleAt(doc: Doc, byte: number): LaidBlock | undefined {
	for (const owner of doc.layout.blocks) {
		const row = owner.lines && titleRowOf(doc, owner);
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

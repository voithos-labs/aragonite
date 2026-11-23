/**
 * The range a removal takes, from the range the editor sent: what it holds whole and where its
 * edges really fall.
 */

import { ownTrailingLineEnding } from '../core/lines';
import { holdsLiteralText } from '../schema/block-facts';
import type { LaidBlock } from './layout';
import {
	contentEnd,
	factsOf,
	findWithin,
	isCell,
	leafAt,
	nodeAt,
	parentOf,
	titleAt,
	titleOwner,
	type Doc
} from './document';
import { byteAt } from './leaf-splice';

/** The range narrowed to what a removal takes: a live code block's hidden opening fence and the
 *  last line ending stay, a title row loses only its text, an emptied container keeps its markers. */
export function removalRange(doc: Doc, start: number, end: number): { from: number; to: number } {
	// A range from the block's first byte holds it whole, so its fences go with it.
	const code = doc.mode === 'live' && !heldAt(doc, start, end) ? leafAt(doc, start) : null;
	const body = code && fenceBody(doc, code.leaf);
	const from = body ? Math.max(start, body.from) : start;
	// A range that leaves the block runs on; the removal keeps the hidden closing line.
	const stays = body && end <= contentEnd(doc, code.leaf);
	let to = stays ? Math.max(from, Math.min(end, body.to)) : end;
	const final = ownTrailingLineEnding(doc.source);
	if (to === doc.source.length && to - final.length > from) to -= final.length;
	const row = titleAt(doc, from);
	if (row && row === titleAt(doc, to)) return { from, to: Math.min(to, row.text!.to) };
	// A start at a title row's line ending moves to the body's first text.
	if (row && from >= row.text!.to) {
		const after = row.text!.to;
		const first = findWithin(doc, after, doc.source.length, (b) => !!b.text && b.text.from > after);
		// A table's rows go whole, so a range reaching one keeps its start before the table.
		if (first && isCell(doc, first) && to > first.text!.from) return { from, to };
		return { from: Math.min(first?.text!.from ?? to, to), to };
	}
	if (leafAt(doc, from) || heldAt(doc, from, to)) return { from, to };
	const text = findWithin(
		doc,
		from,
		to,
		(b) => !!b.text && b.text.from >= from && b.text.from <= to
	);
	const between = text ? doc.source.slice(from, text.text!.from) : '\n';
	return { from: /\n/.test(between) ? from : text!.text!.from, to };
}

/** The first block, outermost first, that the range starting at its first byte holds whole. */
export const heldAt = (doc: Doc, from: number, to: number): LaidBlock | undefined =>
	findWithin(doc, from, from, (b) => heldWhole(doc, b, from, to));

/** A block the range covers from its first byte through its text or its last line goes whole. A
 *  paragraph only empties, unless the range names whole blocks; a title row only ever empties. */
export function heldWhole(doc: Doc, block: LaidBlock, from: number, to: number): boolean {
	if (block.from !== from || titleOwner(doc, block)) return false;
	if (factsOf(doc, block).joins === 'text' && !doc.wholeBlocks) return false;
	return to >= (block.text?.to ?? contentEnd(doc, block));
}

/** Whether some block's text lies partly inside `[from, to)`, a live code block's body alone since
 *  its fence lines are hidden. */
export function holdsText(doc: Doc, from: number, to: number): boolean {
	const shown = (b: LaidBlock) => (doc.mode === 'live' && fenceBody(doc, b)) || b.text;
	return (
		findWithin(doc, from, to, (b) => {
			const text = b.text && shown(b);
			return !!text && text.from < to && from < text.to;
		}) !== undefined
	);
}

/** The body of a fenced block a caret can enter, between its fence lines; null for any other block.
 *  A block drawn as a picture of its source is held whole, never entered. */
export function fenceBody(doc: Doc, leaf: LaidBlock): { from: number; to: number } | null {
	return factsOf(doc, leaf).textPosition === 'always' ? literalBody(doc, leaf) : null;
}

/** The bytes between a literal block's fence lines, a picture of its source's too, or the body its
 *  kind declares where no fence line opens it (a one-line `$$x^2$$`); null for none. */
export function literalBody(doc: Doc, leaf: LaidBlock): { from: number; to: number } | null {
	// A `:::` title row's line reads as an opening fence too, but it has no body to stay inside.
	if (!holdsLiteralText(doc.host.facts, leaf.type, parentOf(doc, leaf)?.type)) return null;
	const node = nodeAt(doc, leaf.path);
	const { raw } = node;
	const fence = doc.host.fence(raw);
	const declared = fence ? null : doc.host.body(node);
	if (declared)
		return { from: byteAt(doc, leaf, declared.start), to: byteAt(doc, leaf, declared.end) };
	if (!fence) return null;
	const { body, closer } = fence;
	const end =
		closer === null
			? raw.replace(/\r?\n$/, '').length
			: closer - (raw[closer - 2] === '\r' ? 2 : 1);
	return { from: byteAt(doc, leaf, body), to: byteAt(doc, leaf, Math.max(body, end)) };
}

/** The last place a caret takes in the block ending at `at`: a fenced block's body end, a container's
 *  or a table's last text; null for text that ends there, or a block with no text place (a rule). */
export function lastPlaceAt(doc: Doc, at: number): number | null {
	const block = [...doc.layout.within(at, at)].filter((b) => contentEnd(doc, b) === at).at(-1);
	if (!block || (block.text && !literalBody(doc, block))) return null;
	return lastPlaceIn(doc, block);
}

function lastPlaceIn(doc: Doc, block: LaidBlock): number | null {
	if (factsOf(doc, block).textPosition === 'never') return null;
	if (block.text) return literalBody(doc, block)?.to ?? block.text.to;
	const count = nodeAt(doc, block.path).children?.length ?? 0;
	const last = count > 0 ? doc.layout.block([...block.path, count - 1]) : undefined;
	return last ? lastPlaceIn(doc, last) : null;
}

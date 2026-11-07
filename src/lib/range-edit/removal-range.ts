/**
 * The range a removal takes, from the range the editor sent: what it holds whole and where its
 * edges really fall.
 */

import type { LaidBlock } from './layout';
import { contentEnd, factsOf, leafAt, nodeAt, titleAt, type Doc } from './document';
import { byteAt } from './leaf-splice';

/** The range narrowed to what a removal takes: a live code block's hidden fences and the last line
 *  ending stay, a title row loses only its text, and a container's markers stay as it empties. */
export function removalRange(doc: Doc, start: number, end: number): { from: number; to: number } {
	const code = doc.mode === 'live' ? leafAt(doc, start) : null;
	const body = code && fenceBody(doc, code.leaf);
	const from = body ? Math.max(start, body.from) : start;
	let to = body ? Math.max(from, Math.min(end, body.to)) : end;
	const final = /\r?\n$/.exec(doc.source)?.[0] ?? '';
	if (to === doc.source.length && to - final.length > from) to -= final.length;
	const row = titleAt(doc, from);
	if (row && row === titleAt(doc, to)) return { from, to: Math.min(to, row.text!.to) };
	// A start at a title row's line ending moves to the body's first text.
	if (row && from >= row.text!.to) {
		const first = doc.layout.blocks.find((b) => b.text && b.text.from > row.text!.to);
		return { from: Math.min(first?.text!.from ?? to, to), to };
	}
	if (leafAt(doc, from) || doc.layout.blocks.some((b) => heldWhole(doc, b, from, to)))
		return { from, to };
	const text = doc.layout.blocks.find((b) => b.text && b.text.from >= from && b.text.from <= to);
	const between = text ? doc.source.slice(from, text.text!.from) : '\n';
	return { from: /\n/.test(between) ? from : text!.text!.from, to };
}

/** A block other than a paragraph that the range covers from its first byte through its text, or
 *  through its last row or closing line: it goes whole. */
export function heldWhole(doc: Doc, block: LaidBlock, from: number, to: number): boolean {
	const facts = factsOf(doc, block);
	const whole = !block.lines || facts.lines === 'rows' || facts.lines === 'fenced';
	if (block.from !== from || facts.joins === 'text' || !whole) return false;
	return to >= (block.text?.to ?? contentEnd(doc, block));
}

/** The body of a fenced block a caret can enter, between its fence lines; null for any other block.
 *  A block drawn as a picture of its source is held whole, never entered. */
function fenceBody(doc: Doc, leaf: LaidBlock): { from: number; to: number } | null {
	const facts = factsOf(doc, leaf);
	if (facts.body !== 'literal' || facts.textPosition !== 'always') return null;
	const raw = nodeAt(doc, leaf.path).raw;
	const fence = doc.host.fence(raw);
	if (!fence) return null;
	const { body, closer } = fence;
	const end =
		closer === null
			? raw.replace(/\r?\n$/, '').length
			: closer - (raw[closer - 2] === '\r' ? 2 : 1);
	return { from: byteAt(doc, leaf, body), to: byteAt(doc, leaf, Math.max(body, end)) };
}

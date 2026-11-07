/**
 * What a copy of a range writes: its bytes as they stand in the deepest container holding both
 * ends, opened by the containers it enters and closed by those it leaves, so a paste elsewhere reads
 * as the same blocks.
 */

import type { LaidBlock } from './layout';
import {
	containersAt,
	contentEnd,
	endingOf,
	factsOf,
	leafAt,
	lineOf,
	nodeAt,
	parentOf,
	titleAt,
	type Doc
} from './document';
import { displayLength } from '../core/lines';
import { byteAt, lineEnd } from './leaf-splice';
import { openingOf } from './markers';

export function copyOf(doc: Doc, from: number, to: number): string {
	const live = doc.mode === 'live';
	// A title row copies its own text, or, when the range leaves it, the container it titles
	// entered from there.
	const startRow = titleAt(doc, from);
	const endRow = titleAt(doc, to);
	if (startRow && startRow === endRow)
		return doc.source.slice(from, Math.min(to, startRow.text!.to));
	const titled = new Set([startRow, endRow].map((row) => row && parentOf(doc, row)));
	// Live, a container the range starts on or runs past the end of is entered or left whole.
	// A container the range holds whole (select-all over a quote) copies whole, markers and all.
	const whole = (c: LaidBlock) =>
		(c.from === from && to >= contentEnd(doc, c)) ||
		(live && (c.from === from || (to === c.to && doc.source.endsWith('\n', c.to))));
	const shared = sharedContainer(doc, from, to, (c) => !titled.has(c) && !whole(c));
	const depth = shared ? shared.path.length : 0;
	let opening = '';
	for (const container of containersAt(doc, from, 'start')) {
		if (container.path.length <= depth) continue;
		if (startRow && parentOf(doc, startRow) === container)
			opening += doc.source.slice(container.from, from);
		else if (container.from < from) opening += openingOf(doc, container, from);
	}
	const end = lineEnd(doc.source, to);
	const eol =
		startRow || endRow ? (doc.source[end - 1] === '\r' ? '\r\n' : '\n') : endingOf(doc.source);
	let closing = live ? '' : fenceCloser(doc, shared, from, to, eol);
	for (const container of containersAt(doc, to, 'end').reverse()) {
		if (container.path.length <= depth || factsOf(doc, container).lines !== 'fenced') continue;
		const last = container.lines!.at(-1)!;
		if (last.own && last.from >= to)
			closing += eol + doc.source.slice(last.from, last.to).replace(/\r?\n$/, '');
	}
	const body =
		opening + carriedEnds(doc, from, to, withoutMarkers(doc, shared, from, to)) + closing;
	if (!live) return body;
	// Live, a range to the end of a container it entered brings that container's last line ending.
	const ended = containersAt(doc, to, 'end').find(
		(c) => c.path.length > depth && to === contentEnd(doc, c)
	);
	return body + (ended ? (/^\r?\n/.exec(doc.source.slice(to))?.[0] ?? '') : '');
}

/** A fenced block the range enters and ends inside closes with its closing line, so the copy never
 *  opens a block that swallows what follows where it is pasted. */
function fenceCloser(doc: Doc, shared: LaidBlock | null, from: number, to: number, eol: string) {
	for (const block of doc.layout.within(from, to)) {
		if (!block.text || factsOf(doc, block).body !== 'literal') continue;
		if (from >= block.from || to <= block.from) continue;
		const closer = doc.host.fence(nodeAt(doc, block.path).raw)?.closer;
		if (closer === null || closer === undefined) continue;
		const lineStart = doc.source.lastIndexOf('\n', byteAt(doc, block, closer) - 1) + 1;
		if (to > lineStart) continue;
		const start = shared ? Math.max(lineStart, lineOf(shared, lineStart).markerTo) : lineStart;
		return eol + doc.source.slice(start, contentEnd(doc, block));
	}
	return '';
}

/** The deepest container both ends sit in, of those `counts` allows; null for the document. */
function sharedContainer(
	doc: Doc,
	from: number,
	to: number,
	counts: (c: LaidBlock) => boolean
): LaidBlock | null {
	const ends = new Set(containersAt(doc, to, 'end'));
	let shared: LaidBlock | null = null;
	for (const b of containersAt(doc, from, 'start')) if (ends.has(b) && counts(b)) shared = b;
	return shared;
}

/** `[from, to)` with the markers of `shared` and every container around it taken off each line
 *  after the first. */
function withoutMarkers(doc: Doc, shared: LaidBlock | null, from: number, to: number): string {
	// A top-level list's lines carry no marker of its own (its items carry theirs), so none comes off.
	const bare = !shared || (shared.path.length === 1 && factsOf(doc, shared).lines === 'items');
	if (bare) return doc.source.slice(from, to);
	let out = '';
	let at = from;
	for (const line of shared.lines!) {
		if (line.to <= from || line.from >= to) continue;
		if (line.from > from) at = Math.max(at, Math.min(line.markerTo, to));
		const end = Math.min(line.to, to);
		if (end > at) out += doc.source.slice(at, end);
		at = end;
	}
	return out;
}

/** In live mode the text at either end comes through the host, so a format run the range cuts
 *  arrives closed. */
function carriedEnds(doc: Doc, from: number, to: number, bytes: string): string {
	if (doc.mode !== 'live') return bytes;
	const start = leafAt(doc, from);
	const end = leafAt(doc, to);
	const carried = (at: NonNullable<typeof start>, a: number, b: number) =>
		doc.host.leaf.carried(doc.tree, at.leaf.path, a, b, doc.mode);
	if (start && end && start.leaf === end.leaf) return carried(start, start.offset, end.offset);
	let out = bytes;
	// Each end's own text, where the source spells it as the block does (no marker inside it).
	const raw = (at: NonNullable<typeof start>) => nodeAt(doc, at.leaf.path).raw;
	if (start) {
		const tail = raw(start).slice(start.offset, displayLength(raw(start)));
		if (out.startsWith(tail))
			out = carried(start, start.offset, start.offset + tail.length) + out.slice(tail.length);
	}
	if (end) {
		const head = raw(end).slice(0, end.offset);
		if (out.endsWith(head))
			out = out.slice(0, out.length - head.length) + carried(end, 0, end.offset);
	}
	return out;
}

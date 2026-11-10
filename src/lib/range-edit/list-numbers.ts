/**
 * The ordered lists a removal shortened, numbered on from where they were
 * (`docs/design/structural-edits.md` § Structural operations). It runs on the removal's bytes
 * before the join question, which reads the numbers a list will show.
 */

import { metadataIfKind } from '../core/nodes';
import { nodeAt, type Doc } from './document';
import type { LaidBlock } from './layout';

/** `out`, the removal of `[from, to)` from `doc`, each ordered list it shortened numbered on. Every
 *  byte `out` changed sits before `to`'s, so the bytes after it are the source's, shifted. */
export function numberedOn(doc: Doc, from: number, to: number, out: string): string {
	const { source, layout } = doc;
	const edits: Edit[] = [];
	for (const list of layout.within(from, to)) {
		const node = nodeAt(doc, list.path);
		if (!node.children || !metadataIfKind(node, 'list')?.ordered) continue;
		const items = node.children.map((_, i) => layout.block([...list.path, i])!);
		const kept = items.filter((item) => item.from >= to);
		if (kept.length === 0 || kept.length === items.length) continue;
		const above = items.filter((item) => item.from < from).at(-1);
		let next = markerOf(source, above ?? items[0])?.number ?? 1;
		if (above) next++;
		for (const item of kept) {
			const marker = markerOf(source, item);
			if (marker && marker.number !== next) renumber(edits, source, item, marker, next);
			next++;
		}
	}
	if (edits.length === 0) return out;
	const shift = out.length - source.length;
	// One pass over the bytes: a long list renumbers every item after the range.
	const parts: string[] = [];
	let read = 0;
	for (const edit of edits.sort((a, b) => a.at - b.at)) {
		parts.push(out.slice(read, edit.at + shift), edit.insert);
		read = edit.at + shift + edit.remove;
	}
	parts.push(out.slice(read));
	return parts.join('');
}

interface Edit {
	at: number;
	remove: number;
	insert: string;
}

interface Marker {
	number: number;
	/** Where its digits sit in the bytes. */
	from: number;
	to: number;
}

/** An ordered item's number and where its digits sit; null for an item opening with none. */
function markerOf(source: string, item: LaidBlock): Marker | null {
	const line = item.lines?.[0];
	if (!line) return null;
	const digits = /^[ \t]*(\d+)/.exec(source.slice(line.from, line.markerTo));
	if (!digits) return null;
	const from = line.from + digits[0].length - digits[1].length;
	return { number: Number(digits[1]), from, to: from + digits[1].length };
}

/** Adds the edits that rewrite the item's digits as `number`, each later line indented to the
 *  item's text column where a wider or narrower number moves it. */
function renumber(edits: Edit[], source: string, item: LaidBlock, marker: Marker, number: number) {
	const insert = String(number);
	edits.push({ at: marker.from, remove: marker.to - marker.from, insert });
	const widened = insert.length - (marker.to - marker.from);
	const lines = item.lines!;
	const column = lines[0].markerTo - lines[0].from;
	for (const line of widened === 0 ? [] : lines.slice(1)) {
		if (line.markerTo - line.from !== column) continue;
		if (widened > 0) edits.push({ at: line.markerTo, remove: 0, insert: ' '.repeat(widened) });
		else if (/^ +$/.test(source.slice(line.markerTo + widened, line.markerTo)))
			edits.push({ at: line.markerTo + widened, remove: -widened, insert: '' });
	}
}

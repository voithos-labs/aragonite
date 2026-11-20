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
	return written(out, edits, out.length - source.length);
}

/** `out`, where a paste split ordered `list` after byte `to` of item `index`, the items after it
 *  numbered on: first the copy of that item's marker at `copyAt` in `out`, when the split made one. */
export function numberedAfterSplit(
	doc: Doc,
	list: LaidBlock,
	index: number,
	to: number,
	out: string,
	copyAt: number | null
): string {
	const { source, layout } = doc;
	const node = nodeAt(doc, list.path);
	if (!metadataIfKind(node, 'list')?.ordered) return out;
	const items = node.children!.map((_, i) => layout.block([...list.path, i])!);
	const shift = out.length - source.length;
	const edits: Edit[] = [];
	const own = markerOf(source, items[index]);
	let next = (own?.number ?? 1) + 1;
	if (copyAt !== null && own) {
		const insert = String(next++);
		const at = copyAt + own.from - items[index].lineAt!(items[index].from).from - shift;
		edits.push({ at, remove: own.to - own.from, insert });
		indented(edits, source, items[index], insert.length - (own.to - own.from), to);
	}
	for (const item of items.slice(index + 1)) {
		const marker = markerOf(source, item);
		if (marker && marker.number !== next) renumber(edits, source, item, marker, next);
		next++;
	}
	return written(out, edits, shift);
}

/** `out` with `edits` made, each at its byte of the source plus `shift`. */
function written(out: string, edits: Edit[], shift: number): string {
	if (edits.length === 0) return out;
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
	const line = item.lineAt?.(item.from);
	if (!line) return null;
	const digits = /^[ \t]*(\d+)/.exec(source.slice(line.from, line.markerTo));
	if (!digits) return null;
	const from = line.from + digits[0].length - digits[1].length;
	return { number: Number(digits[1]), from, to: from + digits[1].length };
}

/** Adds the edits that rewrite the item's digits as `number`, its later lines moved with them. */
function renumber(edits: Edit[], source: string, item: LaidBlock, marker: Marker, number: number) {
	const insert = String(number);
	edits.push({ at: marker.from, remove: marker.to - marker.from, insert });
	indented(edits, source, item, insert.length - (marker.to - marker.from), 0);
}

/** Adds the edits that move the item's later lines starting past byte `from` to its text column,
 *  where its number grew `widened` digits wider. */
function indented(edits: Edit[], source: string, item: LaidBlock, widened: number, from: number) {
	if (widened === 0) return;
	const [first, ...rest] = item.linesIn!(item.from);
	const column = first.markerTo - first.from;
	for (const line of rest) {
		if (line.from < from || line.markerTo - line.from !== column) continue;
		if (widened > 0) edits.push({ at: line.markerTo, remove: 0, insert: ' '.repeat(widened) });
		else if (/^ +$/.test(source.slice(line.markerTo + widened, line.markerTo)))
			edits.push({ at: line.markerTo + widened, remove: -widened, insert: '' });
	}
}

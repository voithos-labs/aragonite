/**
 * The ordered lists a removal shortened or a paste split or grew, numbered on from where they were
 * (`docs/design/structural-edits.md` § Structural operations). A removal's runs on its bytes
 * before the join question, which reads the numbers a list will show.
 */

import { metadataIfKind } from '../core/nodes';
import { numberingOf, type OrderedNumbering } from '../tree-operations/list/ordered-markers';
import { nodeAt, readDoc, type Doc } from './document';
import type { LaidBlock } from './layout';
import type { Edit } from './leaf-splice';

/** `out`, the removal of `[from, to)` from `doc`, each ordered list it shortened numbered on. Every
 *  byte `out` changed sits before `to`'s, so the bytes after it are the source's, shifted. */
export function numberedOn(doc: Doc, from: number, to: number, out: string): string {
	const { source, layout } = doc;
	const edits: Renumbering[] = [];
	for (const list of layout.within(from, to)) {
		const node = nodeAt(doc, list.path);
		if (!node.children || !metadataIfKind(node, 'list')?.ordered) continue;
		const items = node.children.map((_, i) => layout.block([...list.path, i])!);
		const kept = items.filter((item) => item.from >= to);
		if (kept.length === 0 || kept.length === items.length) continue;
		const { start, step } = numberingIn(source, items);
		const above = items.filter((item) => item.from < from).at(-1);
		let next = above ? (markerOf(source, above)?.number ?? 0) + step : start;
		// An item the range ends inside that keeps its marker leads what is left, so it takes the start.
		const held = above ? null : heldLead(source, out, items, from, to);
		if (held) {
			if (held.marker.number !== next) renumber(edits, source, held.item, held.marker, next);
			next += step;
		}
		for (const item of kept) {
			const marker = markerOf(source, item);
			if (marker && marker.number !== next) renumber(edits, source, item, marker, next);
			next += step;
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
	const edits: Renumbering[] = [];
	const own = markerOf(source, items[index]);
	const { step } = numberingIn(source, items);
	let next = (own?.number ?? 1) + step;
	if (copyAt !== null && own) {
		const insert = String(next);
		next += step;
		const at = copyAt + own.from - items[index].lineAt!(items[index].from).from - shift;
		edits.push({ at, remove: own.to - own.from, insert });
		indented(edits, source, items[index], insert.length - (own.to - own.from), to);
	}
	for (const item of items.slice(index + 1)) {
		const marker = markerOf(source, item);
		if (marker && marker.number !== next) renumber(edits, source, item, marker, next);
		next += step;
	}
	return written(out, edits, shift);
}

/** `edit`, a paste whose items the ordered list at `list` took in after its item `index`, with the
 *  items from there on numbered on from that item's number. */
export function numberedAfterTaking(doc: Doc, list: LaidBlock, index: number, edit: Edit): Edit {
	const after = (items: LaidBlock[], source: string, step: number) =>
		(markerOf(source, items[index])?.number ?? 1) + step;
	return numberedFrom(doc, list, edit, index + 1, after);
}

/** `edit`, which opened an item at the head of the ordered list at `list`, with every item
 *  numbered on from the number the list started at. */
export function numberedFromHead(doc: Doc, list: LaidBlock, edit: Edit): Edit {
	const head = doc.layout.block([...list.path, 0]);
	const start = (head && markerOf(doc.source, head)?.number) ?? 1;
	return numberedFrom(doc, list, edit, 0, () => start);
}

/** `edit` with the items of the ordered list at `list` from item `from` on numbered on from the
 *  number `first` reads off the new bytes, by the step the list had before the edit. */
function numberedFrom(
	doc: Doc,
	list: LaidBlock,
	edit: Edit,
	from: number,
	first: (items: LaidBlock[], source: string, step: number) => number
): Edit {
	const before = nodeAt(doc, list.path);
	if (!metadataIfKind(before, 'list')?.ordered) return edit;
	const head = [0, 1].map((i) => doc.layout.block([...list.path, i]));
	const { step } = numberingIn(doc.source, head);
	const read = readDoc(edit.source, doc.host, doc.mode);
	const node = nodeAt(read, list.path);
	if (!metadataIfKind(node, 'list')?.ordered) return edit;
	const items = node.children!.map((_, i) => read.layout.block([...list.path, i])!);
	const edits: Renumbering[] = [];
	let next = first(items, read.source, step);
	for (const item of items.slice(from)) {
		const marker = markerOf(read.source, item);
		if (marker && marker.number !== next) renumber(edits, read.source, item, marker, next);
		next += step;
	}
	const grown = edits
		.filter((e) => e.at < edit.caret)
		.reduce((sum, e) => sum + e.insert.length - e.remove, 0);
	return { source: written(edit.source, edits, 0), caret: edit.caret + grown };
}

/** How the ordered list holding `items` counts, read off its first two numbers in `source`. */
function numberingIn(source: string, items: (LaidBlock | undefined)[]): OrderedNumbering {
	return numberingOf(
		markerOf(source, items[0])?.number ?? null,
		markerOf(source, items[1])?.number ?? null
	);
}

/** The item the range ends inside on its first line, with its marker where it still opens a line
 *  of `out` past the range's start; null where the tail joined a line above. */
function heldLead(
	source: string,
	out: string,
	items: LaidBlock[],
	from: number,
	to: number
): { item: LaidBlock; marker: Marker } | null {
	const item = items.find((laid) => laid.from < to && to < laid.lineAt!(laid.from).to);
	if (!item) return null;
	const shift = out.length - source.length;
	const line = out.lastIndexOf('\n', to + shift - 1) + 1;
	const digits = line < from ? null : /^[ \t>]*(\d+)[.)]/.exec(out.slice(line, to + shift));
	if (!digits || Number(digits[1]) !== markerOf(source, item)?.number) return null;
	// The digits sit in bytes the removal wrote, placed as the source byte `shift` before them.
	const at = line + digits[0].length - 1 - digits[1].length - shift;
	return { item, marker: { number: Number(digits[1]), from: at, to: at + digits[1].length } };
}

/** `out` with `edits` made, each at its byte of the source plus `shift`. */
function written(out: string, edits: Renumbering[], shift: number): string {
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

/** Digits rewritten at byte `at`, or an indent moved with them. */
interface Renumbering {
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
function markerOf(source: string, item: LaidBlock | undefined): Marker | null {
	const line = item?.lineAt?.(item.from);
	if (!line) return null;
	const digits = /^[ \t]*(\d+)/.exec(source.slice(line.from, line.markerTo));
	if (!digits) return null;
	const from = line.from + digits[0].length - digits[1].length;
	return { number: Number(digits[1]), from, to: from + digits[1].length };
}

/** Adds the edits that rewrite the item's digits as `number`, its later lines moved with them. */
function renumber(
	edits: Renumbering[],
	source: string,
	item: LaidBlock,
	marker: Marker,
	number: number
) {
	const insert = String(number);
	edits.push({ at: marker.from, remove: marker.to - marker.from, insert });
	indented(edits, source, item, insert.length - (marker.to - marker.from), 0);
}

/** Adds the edits that move the item's later lines starting past byte `from` to its text column,
 *  where its number grew `widened` digits wider. */
function indented(
	edits: Renumbering[],
	source: string,
	item: LaidBlock,
	widened: number,
	from: number
) {
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

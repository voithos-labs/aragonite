/**
 * A pasted container merging into the one at the caret: its opening is the caret's container's
 * already, and a closing line it brings ends that container in place of the container's own.
 */

import { isBlankText } from '../core/lines';
import { pastMarkers } from './apart';
import type { LaidBlock } from './layout';
import {
	closedByOwnLine,
	containersHolding,
	factsOf,
	firstBodyLine,
	lastLine,
	nodeAt,
	titleOwner,
	type Doc
} from './document';
import { continuation } from './markers';
import type { Edit } from './leaf-splice';
import { lineHead, lineRest } from './lines';

/** What a container's type says two of it must share to merge, as `block` holds it. */
const sharedOf = (doc: Doc, block: LaidBlock, key: string | undefined) =>
	key
		? (nodeAt(doc, block.path).metadata as Record<string, unknown> | undefined)?.[key]
		: undefined;

/** The outermost container at `at` a pasted leading block of its type merges into, where the clipboard
 *  opens with every container from there down to the place's own (a quote in an item takes no list). */
export function takerOf(doc: Doc, at: number, pasted: Doc, first: LaidBlock): LaidBlock | null {
	// The clipboard's opening containers: its first block, then each first child that is one.
	const opening: LaidBlock[] = [];
	for (let b: LaidBlock | undefined = first; b?.container; b = pasted.layout.block([...b.path, 0]))
		opening.push(b);
	const shares = (c: LaidBlock, p: LaidBlock) => {
		const { key } = factsOf(pasted, p).merges;
		return sharedOf(doc, c, key) === sharedOf(pasted, p, key);
	};
	const around = containersHolding(doc, at);
	// An item has no marker on a blank line of its own under its first to stand for a pasted one's,
	// which keeps its own there.
	const marked = (c: LaidBlock) =>
		factsOf(doc, c).lines !== 'first-line' ||
		c !== around.at(-1) ||
		c.lineAt!(at).from === c.lineAt!(c.from).from ||
		!isBlankText(
			lineRest(doc.source, pastMarkers(doc.source, at - lineHead(doc.source, at).length))
		);
	const takes = (c: LaidBlock, i: number) =>
		(i === 0 ? factsOf(pasted, first).merges.into.includes(c.type) : c.type === opening[i].type) &&
		shares(c, opening[i]) &&
		marked(c);
	for (let k = 0; k < around.length; k++) {
		const down = around.slice(k);
		if (down.length <= opening.length && down.every(takes)) return around[k];
	}
	return null;
}

/** The container a pasted leading block breaks out of: the nearest of its type at `at`, where the
 *  two differ and the type says to leave, with `leaf` an item of it and not nested deeper. */
export function leftBy(
	doc: Doc,
	at: number,
	pasted: Doc,
	first: LaidBlock,
	leaf: LaidBlock
): LaidBlock | null {
	const { into, key, onMismatch } = factsOf(pasted, first).merges;
	const nearest = containersHolding(doc, at).findLast((c) => into.includes(c.type));
	if (!nearest || onMismatch !== 'break-out' || leaf.path.length !== nearest.path.length + 2)
		return null;
	return sharedOf(doc, nearest, key) === sharedOf(pasted, first, key) ? null : nearest;
}

/** A caret right after an emptied container's marker takes a pasted container opening with that
 *  marker from its first text; the line is read as written, as a bare marker can read as a setext underline. */
export function emptiedRest(doc: Doc, at: number, pasted: Doc): string | null {
	const blocks = [...pasted.layout.within(0, pasted.source.length)];
	const first = blocks.find((b) => factsOf(pasted, b).lines === 'first-line');
	const line = first && firstBodyLine(first);
	if (!first || !line || first.from !== blocks[0].from) return null;
	const marker = pasted.source.slice(line.from, line.markerTo);
	return lineHead(doc.source, at) === continuation(doc, at) + marker
		? withoutOpening(pasted, first)
		: null;
}

/** The clipboard from the pasted container's first body text on. */
export function withoutOpening(pasted: Doc, first: LaidBlock): string {
	const body = (b: LaidBlock) => b.text && b.from >= first.from && !titleOwner(pasted, b);
	const blocks = pasted.layout.within(first.from, pasted.source.length);
	return pasted.source.slice([...blocks].find(body)?.text?.from ?? first.from);
}

/** `edit` pasted the rest of `first` into `taker`: where `first` brought its own closing line, the
 *  taker's goes. */
export function closedBy(
	doc: Doc,
	pasted: Doc,
	first: LaidBlock,
	taker: LaidBlock,
	edit: Edit
): Edit {
	if (!closedByOwnLine(pasted, first)) return edit;
	const last = lastLine(taker);
	const shift = edit.source.length - doc.source.length;
	const end = last.to + shift;
	// The line goes from its first byte, the markers of the containers around the taker too; a
	// closing line with no line ending of its own takes the one before it.
	const ended = doc.source.endsWith('\n', last.to);
	const above = edit.source.lastIndexOf('\n', last.from + shift - 1);
	const from = ended ? above + 1 : above;
	const start = !ended && edit.source[from - 1] === '\r' ? from - 1 : from;
	return { source: edit.source.slice(0, start) + edit.source.slice(end), caret: edit.caret };
}

/**
 * A pasted container merging into the one at the caret: its opening is the caret's container's
 * already, and a closing line it brings ends that container in place of the container's own.
 */

import type { LaidBlock } from './layout';
import { containersHolding, factsOf, nodeAt, titleOwner, type Doc } from './document';
import { continuation } from './markers';
import { lineHead, type Edit } from './leaf-splice';

/** The deepest container at `at` a pasted leading block merges into. */
export function takerOf(doc: Doc, at: number, pasted: Doc, first: LaidBlock): LaidBlock | null {
	const { into, key } = factsOf(pasted, first).merges;
	const keyOf = (d: Doc, b: LaidBlock) =>
		key ? (nodeAt(d, b.path).metadata as Record<string, unknown> | undefined)?.[key] : undefined;
	let taker: LaidBlock | null = null;
	for (const c of containersHolding(doc, at))
		if (into.includes(c.type) && keyOf(doc, c) === keyOf(pasted, first)) taker = c;
	return taker;
}

/** A caret right after an emptied container's marker takes a pasted container opening with that
 *  marker from its first text; the line is read as written, as a bare marker can read as a setext underline. */
export function emptiedRest(doc: Doc, at: number, pasted: Doc): string | null {
	const first = pasted.layout.blocks.find((b) => factsOf(pasted, b).lines === 'first-line');
	const line = first?.lines!.find((l) => !l.own);
	if (!first || !line || first.from !== pasted.layout.blocks[0].from) return null;
	const marker = pasted.source.slice(line.from, line.markerTo);
	return lineHead(doc.source, at) === continuation(doc, at) + marker
		? withoutOpening(pasted, first)
		: null;
}

/** The clipboard from the pasted container's first body text on. */
export function withoutOpening(pasted: Doc, first: LaidBlock): string {
	const body = (b: LaidBlock) => b.text && b.from >= first.from && !titleOwner(pasted, b);
	return pasted.source.slice(pasted.layout.blocks.find(body)?.text?.from ?? first.from);
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
	const lines = first.lines ?? [];
	if (factsOf(pasted, first).lines !== 'fenced' || lines.length < 2 || !lines.at(-1)!.own)
		return edit;
	const last = taker.lines!.at(-1)!;
	const shift = edit.source.length - doc.source.length;
	const end = last.to + shift;
	// A closing line with no line ending of its own takes the one before it.
	const ended = doc.source.endsWith('\n', last.to);
	const from = ended ? last.from + shift : edit.source.lastIndexOf('\n', last.from + shift - 1);
	const start = !ended && edit.source[from - 1] === '\r' ? from - 1 : from;
	return { source: edit.source.slice(0, start) + edit.source.slice(end), caret: edit.caret };
}

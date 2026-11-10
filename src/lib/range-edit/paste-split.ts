/**
 * Pasted blocks that land as blocks of their own: the block at the caret splits there and the
 * pasted blocks go between its halves, or the caret's list does, where a pasted list leaves it.
 * A range `[at, to)` inside the block's text goes with the split.
 */

import { isBlankText } from '../core/lines';
import type { LaidBlock } from './layout';
import { contentEnd, factsOf, parentOf, type Doc } from './document';
import { numberedAfterSplit } from './list-numbers';
import { continuation } from './markers';
import { lineEnd, lineRest, spliced, type Edit } from './leaf-splice';

/** A pasted list of another kind than `list`, the caret's: the pasted blocks land between the
 *  list's halves, and what the caret's item holds after the caret is the second half's first item. */
export function splitOut(
	doc: Doc,
	list: LaidBlock,
	leaf: LaidBlock,
	at: number,
	to: number,
	clip: string,
	last: string
): Edit {
	const { source } = doc;
	const eol = doc.ending;
	const outside = (c: LaidBlock) => c !== list;
	const outer = continuation(doc, at, outside);
	const item = parentOf(doc, leaf)!;
	const first = item.lines![0];
	// The pasted list stands in the caret list's column, or one would nest in the other: its lines
	// lose the indent the clipboard's first line brings and take the one before the item's marker.
	const brought = /^\n*( *)/.exec(clip)![1].length;
	const body = clip.replace(/\n$/, '').replace(new RegExp(`^ {0,${brought}}`, 'gm'), '');
	const indent = /^[ \t]*/.exec(source.slice(first.from, first.markerTo))![0];
	const pasted =
		(body.startsWith('\n') ? '' : indent) + spliced(doc, at, to, outside, indent)(body);
	// At the item's first text byte the whole item is the second half.
	const whole = at === leaf.text!.from && leaf.path.at(-1) === 0;
	const head = whole
		? source.slice(0, first.from) + pasted
		: source.slice(0, at) + eol + outer + pasted;
	const tail = !whole && !isBlankText(source.slice(to, contentEnd(doc, item)));
	const marker =
		whole || tail ? eol + outer + source.slice(first.from, whole ? at : first.markerTo) : '';
	const copyAt = tail ? head.length + eol.length + outer.length : null;
	const out = head + marker + source.slice(to);
	const numbered = whole ? out : numberedAfterSplit(doc, list, item.path.at(-1)!, to, out, copyAt);
	// The last pasted block stays apart from the line under it where the two would read as one.
	const under = lineEnd(numbered, head.length) + 1;
	const lower = numbered.slice(under + outer.length, lineEnd(numbered, under)) + '\n';
	const upper = { raw: last.replace(/\n?$/, '\n') };
	const [parent, index] = [list.path.slice(0, -1), list.path.at(-1)!];
	const apart =
		!isBlankText(lower) && doc.host.parts(doc.tree, parent, index, upper, { raw: lower }, true);
	const parted = apart
		? numbered.slice(0, under) + outer.trimEnd() + eol + numbered.slice(under)
		: numbered;
	return { source: parted, caret: head.length };
}

/** The block at the caret split there, the pasted blocks between its halves; `lastJoins`: the
 *  last of them takes the text after the caret. */
export function splitAt(
	doc: Doc,
	leaf: LaidBlock,
	at: number,
	to: number,
	clip: string,
	lastJoins: boolean
): Edit {
	const { source } = doc;
	const eol = doc.ending;
	const prefix = continuation(doc, at);
	const blank = prefix.trimEnd();
	const text = leaf.text!;
	const lineStart = source.lastIndexOf('\n', at - 1) + 1;
	// A heading's own marker, which a tail of its own takes again.
	const own = leaf.from >= lineStart ? source.slice(leaf.from, text.from) : '';
	const joinsBefore = factsOf(doc, leaf).joins === 'text';
	const before = source.slice(text.from, at);
	const tail = !isBlankText(lineRest(source, to));
	const lines = spliced(doc, at, to);
	// A heading emptied of its text keeps its marker, which stands before the caret as text would.
	const marked = !joinsBefore && !tail;
	if (before !== '' || marked) {
		// The head keeps its line, a blank line under it (a head of blanks is one already), then the
		// clipboard as written; the tail joins the last block where that takes joined text.
		const parted = !isBlankText(before) || marked;
		const opening = (parted ? eol + blank + eol : eol) + prefix + lines(clip);
		const caret = at + opening.length;
		const closing = tail && !lastJoins ? eol + prefix + (joinsBefore ? '' : own) : '';
		return { source: source.slice(0, at) + opening + closing + source.slice(to), caret };
	}
	const body = clip.replace(/\n$/, '');
	// With nothing before the caret the pasted blocks go before its block, which keeps its line,
	// save a paragraph's text the last pasted block takes.
	const from = joinsBefore ? at : leaf.from;
	const opening = lines(body);
	const caret = from + opening.length;
	// An empty line that text follows right after stays, keeping the pasted blocks apart from it;
	// a line the paste took the text of was never empty.
	const under = lineEnd(source, to) + 1;
	const next = source.slice(under, lineEnd(source, under));
	const kept = at === to && !tail && next.replace(/^[\s>]*/, '') !== '' ? eol + blank : '';
	const apart = eol + (body !== clip ? blank + eol : '') + prefix + (joinsBefore ? '' : own);
	const taken = joinsBefore && lastJoins && body === clip;
	const closing = tail ? (taken ? '' : apart) : kept;
	return { source: source.slice(0, from) + opening + closing + source.slice(to), caret };
}

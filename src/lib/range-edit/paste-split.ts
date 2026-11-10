/**
 * Pasted blocks that land as blocks of their own: the block at the caret splits there and the
 * pasted blocks go between its halves, or the caret's list does, where a pasted list leaves it.
 */

import { isBlankText } from '../core/lines';
import type { LaidBlock } from './layout';
import { contentEnd, endingOf, factsOf, parentOf, type Doc } from './document';
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
	clip: string,
	last: string
): Edit {
	const { source } = doc;
	const eol = endingOf(source);
	const outside = (c: LaidBlock) => c !== list;
	const outer = continuation(doc, at, outside);
	const item = parentOf(doc, leaf)!;
	const first = item.lines![0];
	const pasted = spliced(doc, at, at, outside)(clip.replace(/\n$/, ''));
	// At the item's first text byte the whole item is the second half.
	const whole = at === leaf.text!.from && leaf.path.at(-1) === 0;
	const head = whole
		? source.slice(0, first.from) + pasted
		: source.slice(0, at) + eol + outer + pasted;
	const tail = !whole && !isBlankText(source.slice(at, contentEnd(doc, item)));
	const marker =
		whole || tail ? eol + outer + source.slice(first.from, whole ? at : first.markerTo) : '';
	const copyAt = tail ? head.length + eol.length + outer.length : null;
	const out = head + marker + source.slice(at);
	const numbered = whole ? out : numberedAfterSplit(doc, list, item.path.at(-1)!, at, out, copyAt);
	// The last pasted block stays apart from the line under it where the two would read as one.
	const under = head.length + eol.length;
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

/** `endsInText`: the clipboard opens or closes with a paragraph, where the caret can follow it;
 *  `lastJoins`: its last block takes the text after the caret. */
export function splitAt(
	doc: Doc,
	leaf: LaidBlock,
	at: number,
	clip: string,
	endsInText: boolean,
	lastJoins: boolean
): Edit {
	const { source } = doc;
	const eol = endingOf(source);
	const prefix = continuation(doc, at);
	const blank = prefix.trimEnd();
	const text = leaf.text!;
	const lineStart = source.lastIndexOf('\n', at - 1) + 1;
	// A heading's own marker, which a tail of its own takes again.
	const own = leaf.from >= lineStart ? source.slice(leaf.from, text.from) : '';
	const joinsBefore = factsOf(doc, leaf).joins === 'text';
	const before = source.slice(text.from, at);
	const tail = !isBlankText(lineRest(source, at));
	const lines = spliced(doc, at, at);
	if (before !== '') {
		// The head keeps its line, a blank line under it (a head of blanks is one already), then the
		// clipboard as written; the tail joins the last block where that takes joined text.
		const opening = (!isBlankText(before) ? eol + blank + eol : eol) + prefix + lines(clip);
		const caret = at + opening.length;
		const closing = tail && !lastJoins ? eol + prefix + (joinsBefore ? '' : own) : '';
		return { source: source.slice(0, at) + opening + closing + source.slice(at), caret };
	}
	const body = clip.replace(/\n$/, '');
	if (!tail && !joinsBefore) {
		// An emptied heading stays as an empty line, the pasted blocks under it.
		const above = source.slice(source.lastIndexOf('\n', lineStart - 2) + 1, lineStart);
		const apart = lineStart > 0 && /[^\s>]/.test(above) ? blank + eol : '';
		const opening = apart + blank + eol + prefix + lines(body);
		const out = source.slice(0, lineStart) + opening + source.slice(at);
		const caret = lineStart + (endsInText ? opening.length : apart.length + blank.length);
		return { source: out, caret };
	}
	// With nothing before the caret the pasted blocks go before its block, which keeps its line,
	// save a paragraph's text the last pasted block takes.
	const from = joinsBefore ? at : leaf.from;
	const opening = lines(body);
	const caret = from + opening.length;
	// An empty line that text follows right after stays, keeping the pasted blocks apart from it.
	const next = source.slice(lineEnd(source, at) + 1, lineEnd(source, lineEnd(source, at) + 1));
	const kept = !tail && next.replace(/^[\s>]*/, '') !== '' ? eol + blank : '';
	const apart = eol + (body !== clip ? blank + eol : '') + prefix + (joinsBefore ? '' : own);
	const taken = joinsBefore && lastJoins && body === clip;
	const closing = tail ? (taken ? '' : apart) : kept;
	return { source: source.slice(0, from) + opening + closing + source.slice(at), caret };
}

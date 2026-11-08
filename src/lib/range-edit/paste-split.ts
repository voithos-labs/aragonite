/**
 * Pasted blocks that land as blocks of their own: the block at the caret splits there and the
 * pasted blocks go between its halves.
 */

import { isBlankText } from '../core/lines';
import type { LaidBlock } from './layout';
import { endingOf, factsOf, type Doc } from './document';
import { continuation } from './markers';
import { lineEnd, lineRest, spliced, type Edit } from './leaf-splice';

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

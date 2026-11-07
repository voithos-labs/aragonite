/**
 * The words a spell check reads out of one prose block: text runs only, so a code span, a URL,
 * raw HTML or a marker is never a word. Offsets are raw offsets into the block, which is what a
 * mark decoration is measured in.
 */

import type { InlineNode } from '../core/nodes';
import { inlineDescendants } from '../core/inline/walk';

export interface WordSpan {
	word: string;
	start: number;
	end: number;
}

// A run of letters, digits or underscores, with apostrophes inside it (`don't`, `it’s`). Digits
// and underscores join the run so `abc123` and `snake_case` are seen whole and then skipped.
const RUN = /[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*/gu;
const NOT_A_WORD = /[\p{N}_]/u;
const INNER_CAPITAL = /\p{Ll}\p{Lu}/u;

/** Inline kinds whose bytes are never prose: their text is literal, a destination, or markup. */
const OPAQUE_KINDS = new Set([
	'inlineCode',
	'autolink',
	'rawHtml',
	'escape',
	'entityReference',
	'hardLineBreak',
	'image'
]);

/** The checkable words of a block, in order, from the inline parse of its raw. */
export function wordSpans(raw: string, inline: readonly InlineNode[]): WordSpan[] {
	const out: WordSpan[] = [];
	for (const node of inlineDescendants(inline, (n) => !OPAQUE_KINDS.has(n.kind))) {
		if (node.kind !== 'text') continue;
		const text = raw.slice(node.start, node.end);
		for (const match of text.matchAll(RUN)) {
			const word = match[0];
			if (!isCheckable(word)) continue;
			out.push({
				word,
				start: node.start + match.index,
				end: node.start + match.index + word.length
			});
		}
	}
	return out;
}

/** A one-letter token, a token with a digit or an underscore, and camelCase are identifiers or
 *  abbreviations more often than misspellings, so none of them is checked. */
export function isCheckable(word: string): boolean {
	if (word.length < 2) return false;
	if (NOT_A_WORD.test(word)) return false;
	return !INNER_CAPITAL.test(word);
}

/** The span holding `offset`, bounds included, so a caret right after a word still names it. */
export function spanAt(spans: readonly WordSpan[], offset: number): WordSpan | null {
	for (const span of spans) {
		if (span.start > offset) break;
		if (offset <= span.end) return span;
	}
	return null;
}

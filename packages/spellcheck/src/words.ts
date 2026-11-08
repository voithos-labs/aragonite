/**
 * The words a spell check reads out of one prose block: text runs reached only through prose
 * constructs (emphasis, a link's label), so code, a destination, raw HTML, a marker or any kind it
 * doesn't know is never a word. Offsets are raw offsets into the block.
 */

/** An inline construct as the editor parses it: its kind, its bytes in the block, its children. */
export interface InlineRun {
	readonly kind: string;
	readonly start: number;
	readonly end: number;
	readonly children?: readonly InlineRun[];
}

export interface WordSpan {
	word: string;
	start: number;
	end: number;
}

/** A misspelled word in the document: its bytes, and what it says. */
export interface Misspelling {
	from: number;
	to: number;
	word: string;
}

// A run of letters, digits or underscores, with apostrophes inside it (`don't`, `it’s`). Digits
// and underscores join the run so `abc123` and `snake_case` are seen whole and then skipped.
const RUN = /[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*/gu;
const NOT_A_WORD = /[\p{N}_]/u;
const INNER_CAPITAL = /\p{Ll}\p{Lu}/u;

/** The constructs whose text a reader sees as prose; everything else keeps its bytes to itself. */
const PROSE = new Set(['emphasis', 'strong', 'strikethrough', 'link', 'unresolvedReference']);

/** The checkable words of a block, in order, from the inline parse of its raw. */
export function wordSpans(raw: string, inline: readonly InlineRun[]): WordSpan[] {
	const out: WordSpan[] = [];
	for (const node of proseText(inline)) {
		const text = raw.slice(node.start, node.end);
		for (const match of text.matchAll(RUN)) {
			const word = match[0];
			if (!isCheckable(word)) continue;
			const start = node.start + match.index;
			out.push({ word, start, end: start + word.length });
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

// Iterative, since nesting depth comes from the document.
function* proseText(nodes: readonly InlineRun[]): Generator<InlineRun> {
	const stack = [...nodes].reverse();
	while (stack.length > 0) {
		const node = stack.pop()!;
		if (node.kind === 'text') yield node;
		else if (PROSE.has(node.kind) && node.children) {
			for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
		}
	}
}

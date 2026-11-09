/**
 * The words a spell check reads out of one text block: text pieces reached only through prose
 * constructs (emphasis, a link's label), so code, a destination, raw HTML, a marker or any kind it
 * doesn't know is never a word. Every span is in document bytes, for the menus and the paint alike.
 */

/** One inline construct of a block, in document bytes, as `Block.pieces` holds it. */
export interface Piece {
	readonly kind: string;
	readonly from: number;
	readonly to: number;
	readonly text: string;
	readonly children: readonly Piece[];
}

/** A text block as the editor's `blockAt` reads it: its text, its pieces, and the map between a
 *  text offset and a document byte, which a container's markers between lines break apart. */
export interface TextBlock {
	readonly text: string;
	readonly pieces: readonly Piece[];
	byteAt(textOffset: number): number;
	offsetAt(byte: number): number;
}

/** A word in the document: its bytes, and what it says. */
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

/** The checkable words of a block, in order. */
export function wordSpans(block: TextBlock): Misspelling[] {
	const out: Misspelling[] = [];
	for (const piece of proseText(block.pieces)) {
		const base = block.offsetAt(piece.from);
		for (const match of piece.text.matchAll(RUN)) {
			const word = match[0];
			if (!isCheckable(word)) continue;
			const start = base + match.index;
			out.push({ word, from: block.byteAt(start), to: block.byteAt(start + word.length) });
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

/** The word holding byte `at`, bounds included, so a caret right after a word still names it. */
export function spanAt(spans: readonly Misspelling[], at: number): Misspelling | null {
	for (const span of spans) {
		if (span.from > at) break;
		if (at <= span.to) return span;
	}
	return null;
}

// Iterative, since nesting depth comes from the document.
function* proseText(pieces: readonly Piece[]): Generator<Piece> {
	const stack = [...pieces].reverse();
	while (stack.length > 0) {
		const piece = stack.pop()!;
		if (piece.kind === 'text') yield piece;
		else if (PROSE.has(piece.kind)) {
			for (let i = piece.children.length - 1; i >= 0; i--) stack.push(piece.children[i]);
		}
	}
}

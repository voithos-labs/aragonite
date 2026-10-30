/**
 * The editor's one source of text units: grapheme clusters and words, by the Unicode segmentation
 * rules every engine ships in `Intl.Segmenter`, words cut one way on every engine. Null where a
 * platform has no segmenter.
 */

let graphemes: Intl.Segmenter | null | undefined;
let words: Intl.Segmenter | null | undefined;

function create(granularity: 'grapheme' | 'word'): Intl.Segmenter | null {
	return typeof Intl.Segmenter === 'function'
		? new Intl.Segmenter(undefined, { granularity })
		: null;
}

export function graphemeSegmenter(): Intl.Segmenter | null {
	if (graphemes === undefined) graphemes = create('grapheme');
	return graphemes;
}

function wordSegmenter(): Intl.Segmenter | null {
	if (words === undefined) words = create('word');
	return words;
}

/** One word segment of a text: where it starts, its text, and whether it's a word or the
 *  punctuation and spaces between words. */
export interface WordSegment {
	index: number;
	segment: string;
	isWordLike: boolean;
}

/** The word segments of a text, asked for by the offset one holds. */
export interface WordSegments {
	containing(at: number): WordSegment | undefined;
}

/** Whether the platform has a word segmenter; `wordSegments` returns null without one. */
export function hasWordSegmenter(): boolean {
	return wordSegmenter() !== null;
}

/** `text` cut into words the same on every engine: a `.` or `:` between two letters always ends a
 *  word (`foo.bar`), and any segment with a letter or digit is a word, whatever the engine says. */
export function wordSegments(text: string): WordSegments | null {
	const segments = wordSegmenter()?.segment(text);
	if (!segments) return null;
	return {
		containing: (at) => {
			const found = segments.containing(at);
			if (!found) return undefined;
			const { index, segment } = found;
			if (!WORD_LIKE.test(segment)) return { index, segment, isWordLike: false };
			return piecesOf(segment, index).find((piece) => at < piece.index + piece.segment.length);
		}
	};
}

const WORD_LIKE = /[\p{L}\p{Nd}\p{Nl}]/u;
// A full stop or colon, ASCII, fullwidth or small, which some engines read as joining two letters.
const JOINER = /[.:\uFE55\uFF0E\uFF1A]/;
const DIGIT = /\p{Nd}/u;
const MARK = /\p{M}/u;

/** A word segment cut at each joiner not between two digits (`3.14` stays one), the joiner and any
 *  combining marks after it a piece of their own. */
function piecesOf(word: string, start: number): WordSegment[] {
	const pieces: string[] = [];
	let from = 0;
	for (let i = 0; i < word.length; i++) {
		if (!JOINER.test(word[i]) || (DIGIT.test(word[i - 1] ?? '') && DIGIT.test(word[i + 1] ?? ''))) {
			continue;
		}
		let end = i + 1;
		while (end < word.length && MARK.test(word[end])) end++;
		pieces.push(word.slice(from, i), word.slice(i, end));
		from = end;
		i = end - 1;
	}
	pieces.push(word.slice(from));
	let index = start;
	return pieces
		.filter((piece) => piece.length > 0)
		.map((segment) => {
			const piece = { index, segment, isWordLike: WORD_LIKE.test(segment) };
			index += segment.length;
			return piece;
		});
}

/** Whether `text` is empty or one user-perceived character, a code point apiece where the platform
 *  has no segmenter. */
export function isAtMostOneCharacter(text: string): boolean {
	if (text.length <= 1) return true;
	const units = (graphemeSegmenter()?.segment(text) ?? Array.from(text))[Symbol.iterator]();
	units.next();
	return units.next().done === true;
}

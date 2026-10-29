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

/** `text` cut into words, the same on every engine: engines' segmenters disagree whether a `.` or a
 *  `:` between two letters joins them (`foo.bar`), so it never does, as in Chromium and Word. */
export function wordSegments(text: string): WordSegments | null {
	const segmenter = wordSegmenter();
	if (!segmenter) return null;
	const cut: WordSegment[] = [];
	for (const { index, segment, isWordLike } of segmenter.segment(text)) {
		if (isWordLike && JOINER.test(segment)) cutAtJoiners(segment, index, cut);
		else cut.push({ index, segment, isWordLike: isWordLike === true });
	}
	return {
		containing: (at) => {
			if (at < 0 || at >= text.length) return undefined;
			let low = 0;
			let high = cut.length - 1;
			while (low < high) {
				const mid = (low + high + 1) >> 1;
				if (cut[mid].index <= at) low = mid;
				else high = mid - 1;
			}
			return cut[low];
		}
	};
}

// A full stop or colon, ASCII or fullwidth, which some engines read as joining two letters.
const JOINER = /[.:\uFF0E\uFF1A]/;
const DIGIT = /\p{Nd}/u;
const MARK = /\p{M}/u;

/** A word segment cut at each joiner not between two digits (`3.14` stays one), the joiner and any
 *  combining marks after it a segment of their own, appended to `out`. */
function cutAtJoiners(word: string, start: number, out: WordSegment[]): void {
	let from = 0;
	for (let i = 0; i < word.length; i++) {
		if (!JOINER.test(word[i]) || (DIGIT.test(word[i - 1] ?? '') && DIGIT.test(word[i + 1] ?? ''))) {
			continue;
		}
		let end = i + 1;
		while (end < word.length && MARK.test(word[end])) end++;
		if (i > from) out.push({ index: start + from, segment: word.slice(from, i), isWordLike: true });
		out.push({ index: start + i, segment: word.slice(i, end), isWordLike: false });
		from = end;
		i = end - 1;
	}
	if (from < word.length)
		out.push({ index: start + from, segment: word.slice(from), isWordLike: true });
}

/** Whether `text` is empty or one user-perceived character, a code point apiece where the platform
 *  has no segmenter. */
export function isAtMostOneCharacter(text: string): boolean {
	if (text.length <= 1) return true;
	const units = (graphemeSegmenter()?.segment(text) ?? Array.from(text))[Symbol.iterator]();
	units.next();
	return units.next().done === true;
}

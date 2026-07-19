/**
 * The three conformance corpus strata the differ draws from: exhaustive short
 * enumeration, seeded random sampling, and the inline-only slice of the
 * CommonMark spec examples. All three feed markdown into `referenceInlineNodes`.
 */
import specExamplesJson from './spec-examples.json';

// ── Alphabets ────────────────────────────────────────────────────────────────

/**
 * Inline-active punctuation plus a letter and a space — the characters that
 * actually change how the inline parser tokenizes. No `~`: strikethrough is a
 * GFM extension, outside the CommonMark baseline this corpus is measured against.
 */
export const ENUM_ALPHABET = ['*', '_', '`', '[', ']', '(', ')', '!', '\\', 'a', ' '] as const;

/**
 * Random-only characters: HTML/entity sinks, quotes, non-ASCII (including an
 * astral codepoint), a digit, a newline, and a second letter. They widen the
 * sampled stratum into byte territory the enumeration deliberately omits to keep
 * its combinatorial space small.
 */
export const RANDOM_EXTRAS = [
	'<',
	'>',
	'&',
	'"',
	"'",
	'#',
	'é',
	'中',
	'\u{10100}',
	'0',
	'\n',
	'b'
] as const;

// ── Exhaustive enumeration ───────────────────────────────────────────────────

/** Every string of length 1..maxLen over `ENUM_ALPHABET`, shortest first. */
export function enumerateCorpus(maxLen: number): string[] {
	const corpus: string[] = [];
	let stringsAtLength: string[] = [''];
	for (let length = 1; length <= maxLen; length++) {
		stringsAtLength = stringsAtLength.flatMap((prefix) =>
			ENUM_ALPHABET.map((char) => prefix + char)
		);
		// No spread-push: at maxLen 5 the top tier is 11^5 = 161k strings, and
		// push(...arr) passes each as a call argument — that overflows the stack.
		for (const string of stringsAtLength) corpus.push(string);
	}
	return corpus;
}

// ── Seeded random sampling ───────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * `count` strings of length `minLen`..`maxLen`, each character drawn from
 * `ENUM_ALPHABET` ∪ `RANDOM_EXTRAS`. Deterministic in `seed` — the same seed and
 * bounds reproduce the exact sequence, which is what pins the baseline.
 */
export function sampleCorpus(
	seed: number,
	count: number,
	minLen: number,
	maxLen: number
): string[] {
	const alphabet = [...ENUM_ALPHABET, ...RANDOM_EXTRAS];
	const nextRandom = mulberry32(seed);
	const lengthSpan = maxLen - minLen + 1;
	const strings: string[] = [];
	for (let i = 0; i < count; i++) {
		const length = minLen + Math.floor(nextRandom() * lengthSpan);
		let string = '';
		for (let j = 0; j < length; j++) {
			string += alphabet[Math.floor(nextRandom() * alphabet.length)];
		}
		strings.push(string);
	}
	return strings;
}

// ── Spec-example fixture ─────────────────────────────────────────────────────

export interface SpecExample {
	section: string;
	example: number;
	markdown: string;
}

interface SpecExampleFixture {
	referenceVersion: string;
	examples: SpecExample[];
}

/** The committed inline-only slice of the CommonMark spec examples. */
export function loadSpecExamples(): SpecExample[] {
	const fixture: SpecExampleFixture = specExamplesJson;
	return fixture.examples;
}

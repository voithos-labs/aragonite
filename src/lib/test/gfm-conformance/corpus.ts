/**
 * The conformance corpus: three strata the inline differ draws from (exhaustive short
 * enumeration, seeded random sampling, the inline-only slice of the CommonMark spec
 * examples), plus the spec's link reference definition examples, compared whole-document.
 */
import specExamplesJson from './spec-examples.json';

// ── Alphabets ────────────────────────────────────────────────────────────────

/**
 * The characters that actually change how the inline parser tokenizes. No `~`:
 * strikethrough is a GFM extension, outside the CommonMark baseline measured against.
 */
export const ENUM_ALPHABET = ['*', '_', '`', '[', ']', '(', ')', '!', '\\', 'a', ' '] as const;

/**
 * Widens the sampled stratum into byte territory the enumeration deliberately omits to
 * keep its combinatorial space small.
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
	return [...enumerateStrings(ENUM_ALPHABET, 1, maxLen)];
}

/** Every string of length minLen..maxLen over `alphabet`, shortest first and in alphabet order
 *  within a length, one at a time: past length 6 the strings don't fit in memory together. */
export function* enumerateStrings(
	alphabet: readonly string[],
	minLen: number,
	maxLen: number
): Generator<string> {
	for (let length = minLen; length <= maxLen; length++) {
		const digits = new Array<number>(length).fill(0);
		while (true) {
			yield digits.map((digit) => alphabet[digit]).join('');
			let place = length - 1;
			while (place >= 0 && ++digits[place] === alphabet.length) digits[place--] = 0;
			if (place < 0) break;
		}
	}
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
 * Strings over `ENUM_ALPHABET` ∪ `RANDOM_EXTRAS`, deterministic in `seed` — the same
 * seed and bounds reproduce the exact sequence, which is what pins the baseline.
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
	definitionExamples: SpecExample[];
}

/** The committed inline-only slice of the CommonMark spec examples. */
export function loadSpecExamples(): SpecExample[] {
	const fixture: SpecExampleFixture = specExamplesJson;
	return fixture.examples;
}

/** Every link reference definition example (§4.7), whatever blocks it holds. */
export function loadDefinitionExamples(): SpecExample[] {
	const fixture: SpecExampleFixture = specExamplesJson;
	return fixture.definitionExamples;
}

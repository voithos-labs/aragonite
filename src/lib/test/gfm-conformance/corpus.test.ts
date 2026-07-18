import { describe, it, expect } from 'vitest';
import { referenceInlineReading, REFERENCE_VERSION } from './reference';
import {
	ENUM_ALPHABET,
	RANDOM_EXTRAS,
	enumerateCorpus,
	sampleCorpus,
	loadSpecExamples
} from './corpus';
import specExamples from './spec-examples.json';

// ── Enumeration ──────────────────────────────────────────────────────────────

describe('enumerateCorpus', () => {
	it('emits every string of length 1..maxLen — 11 + 121 = 132 at maxLen 2', () => {
		const corpus = enumerateCorpus(2);
		expect(corpus).toHaveLength(ENUM_ALPHABET.length + ENUM_ALPHABET.length ** 2);
		expect(corpus).toHaveLength(132);
	});

	it('handles the full-sweep maxLen 5 — 161k strings at the top length', () => {
		expect(enumerateCorpus(5)).toHaveLength(11 + 121 + 1331 + 14641 + 161051);
	});

	it('covers every single character and has no duplicates', () => {
		const corpus = enumerateCorpus(2);
		for (const char of ENUM_ALPHABET) expect(corpus).toContain(char);
		expect(new Set(corpus).size).toBe(corpus.length);
	});

	it('draws only from ENUM_ALPHABET — never the random-only extras', () => {
		const allowed = new Set<string>(ENUM_ALPHABET);
		for (const string of enumerateCorpus(2)) {
			for (const char of string) expect(allowed.has(char)).toBe(true);
		}
	});
});

// ── Seeded sampling ──────────────────────────────────────────────────────────

describe('sampleCorpus', () => {
	it('is deterministic — same seed and bounds reproduce the exact strings', () => {
		expect(sampleCorpus(42, 200, 1, 12)).toEqual(sampleCorpus(42, 200, 1, 12));
	});

	it('diverges on a different seed', () => {
		expect(sampleCorpus(1, 200, 1, 12)).not.toEqual(sampleCorpus(2, 200, 1, 12));
	});

	it('honors count and the length window', () => {
		const strings = sampleCorpus(7, 150, 3, 9);
		expect(strings).toHaveLength(150);
		for (const string of strings) {
			const codepoints = [...string];
			expect(codepoints.length).toBeGreaterThanOrEqual(3);
			expect(codepoints.length).toBeLessThanOrEqual(9);
		}
	});

	it('never emits the GFM-only strikethrough tilde', () => {
		for (const string of sampleCorpus(99, 500, 1, 16)) expect(string).not.toContain('~');
	});

	it('draws from ENUM_ALPHABET plus the random extras, and nothing else', () => {
		const allowed = new Set<string>([...ENUM_ALPHABET, ...RANDOM_EXTRAS]);
		const seen = new Set<string>();
		for (const string of sampleCorpus(3, 500, 1, 16)) {
			for (const char of string) {
				expect(allowed.has(char)).toBe(true);
				seen.add(char);
			}
		}
		const extrasSeen = RANDOM_EXTRAS.filter((char) => seen.has(char));
		expect(extrasSeen.length).toBeGreaterThan(0);
	});
});

// ── Spec-example fixture ─────────────────────────────────────────────────────

describe('loadSpecExamples', () => {
	it('yields single-paragraph spec examples, mostly readable under the span guard', () => {
		const examples = loadSpecExamples();
		expect(examples.length).toBeGreaterThan(100);
		let readable = 0;
		for (const { markdown } of examples) {
			const reading = referenceInlineReading(markdown.replace(/\n$/, ''));
			if ('nodes' in reading) readable++;
			// The fixture filter selected single-paragraph docs; the span guard may
			// still skip ones the block layer trims, but never for paragraph shape.
			else expect(reading.skip).toBe('partial-span');
		}
		expect(readable).toBeGreaterThan(200);
	});

	it('carries section and example provenance for each entry', () => {
		for (const { section, example } of loadSpecExamples()) {
			expect(section.length).toBeGreaterThan(0);
			expect(Number.isInteger(example)).toBe(true);
		}
	});

	it('is keyed to the reference version it was generated against', () => {
		expect(specExamples.referenceVersion).toBe(REFERENCE_VERSION);
	});
});

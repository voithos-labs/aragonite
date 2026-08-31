import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { diffInput, type Divergence } from './differ';
import { arbInlineSource, freshOrFixedSeed } from '../invariants/arbitraries';

// The semantic oracle the byte-conservation and offset-tiling properties can NOT be:
// they stay green when emphasis is classified into the WRONG kinds, since the bytes
// still tile. Blind spot, by construction: breaking aragonite's code-point read makes it
// CONVERGE with the equally-wrong UTF-16 reference, so astral-flanking regressions are
// the baseline slice ratchet's job (it pins astral inputs as must-diverge), not this.

// ── Deliberate-divergence allowlist (baseline.json classes, as predicates) ─────
// A random input is never in baseline.json, so each class is a predicate, not a lookup.
// A divergence matching NONE of them is the bug class this oracle exists to catch.

// emphasis-flanking-astral: ours classifies astral punctuation by code point per
// spec; commonmark.js reads UTF-16 units and misclassifies the flanking neighbor.
const ASTRAL_CODE_POINT = /[\u{10000}-\u{10FFFF}]/u;

// gfm-bare-autolink: aragonite parses GFM bare www / http(s) / email autolinks;
// the pinned CommonMark 0.31.2 reference has no autolink extension.
const GFM_BARE_AUTOLINK = /www\.|https?:\/\/|[^\s<>()@]+@[^\s<>()@]+\.[^\s<>()@]+/i;

// image-alt-structure: ours flattens an image alt to its raw label bytes (the
// editor's product model); commonmark keeps structured children. Reachable here
// via `!` + link adjacency producing an image whose alt carries inline markup.
const IMAGE = /!\[/;

function isDocumentedDivergence(input: string): boolean {
	return ASTRAL_CODE_POINT.test(input) || GFM_BARE_AUTOLINK.test(input) || IMAGE.test(input);
}

// Strikethrough is a GFM extension the pinned CommonMark reference cannot express, so
// `~` inputs are skipped before the differential (the corpus's ENUM_ALPHABET omits it
// for the same reason) rather than mapped to a construct the reference lacks.
function isOutsideBaseline(input: string): boolean {
	return input.includes('~');
}

function describeUnexpected(divergence: Divergence): string {
	return (
		'inline node kinds diverge from commonmark on a non-deliberate input ' +
		'(neither astral flanking, a GFM bare autolink, nor an image alt):\n' +
		`  input:  ${JSON.stringify(divergence.input)}\n` +
		`  ours:   ${JSON.stringify(divergence.ours)}\n` +
		`  theirs: ${JSON.stringify(divergence.theirs)}`
	);
}

const PARAMS = { numRuns: 8000, seed: freshOrFixedSeed(424242) } as const;

describe('kind-differential: inline node kinds vs commonmark over arbInlineSource', () => {
	it('every divergence is a documented deliberate class', () => {
		fc.assert(
			fc.property(arbInlineSource, (source) => {
				if (isOutsideBaseline(source)) return;
				const divergence = diffInput(source);
				if (divergence === null) return;
				if (!isDocumentedDivergence(source)) throw new Error(describeUnexpected(divergence));
			}),
			PARAMS
		);
	});

	// Reachability + completeness self-test (rules.md: a generator that cannot reach the
	// class proves nothing, and an allowlist that excuses everything is vacuously green).
	// Fixed seed so it is a deterministic guard, not part of the fresh lane's search.
	it('arbInlineSource reaches all three documented classes and no fourth', () => {
		const samples = fc.sample(arbInlineSource, { numRuns: 30000, seed: 424242 });
		let astral = 0;
		let autolink = 0;
		let image = 0;
		const unexplained: string[] = [];
		for (const source of samples) {
			if (isOutsideBaseline(source)) continue;
			if (diffInput(source) === null) continue;
			if (ASTRAL_CODE_POINT.test(source)) astral++;
			else if (GFM_BARE_AUTOLINK.test(source)) autolink++;
			else if (IMAGE.test(source)) image++;
			else unexplained.push(source);
		}
		expect(unexplained).toEqual([]);
		expect(astral).toBeGreaterThan(0);
		expect(autolink).toBeGreaterThan(0);
		expect(image).toBeGreaterThan(0);
	});
});

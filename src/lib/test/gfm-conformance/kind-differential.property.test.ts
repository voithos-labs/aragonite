import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { diffInput, type Divergence } from './differ';
import { arbInlineSource, freshOrFixedSeed } from '../invariants/arbitraries';

// The semantic oracle the byte-conservation and offset-tiling properties can NOT
// be. Those assert that bytes tile the range; the 0.9.28 audit proved they stay
// green when emphasis is classified into the WRONG kinds — the bytes still tile,
// they are merely under the wrong node kinds. This property compares inline node
// KINDS and NESTING against commonmark over the SAME arbInlineSource those
// properties run on, so a misclassification that leaves the byte layout intact
// still fails here.
//
// Division of labor with the astral read: a commonmark differential structurally
// cannot catch an astral-flanking regression. Breaking aragonite's code-point read
// makes it read UTF-16 units too — it CONVERGES with the equally-wrong reference,
// so the divergence vanishes and nothing here fires. That regression is the
// baseline slice ratchet's job (it pins astral inputs as must-diverge). This
// property's target is broad emphasis misclassification over random sources, which
// produces fresh divergences on ordinary inputs the baseline never enumerated.

// ── Deliberate-divergence allowlist (baseline.json classes, as predicates) ─────
// A random input is never in baseline.json, so the allowlist is a predicate, not a
// lookup. Each mirrors one documented "deliberate, must not regress" class; a
// divergence on an input matching NONE of them is the bug class this oracle exists
// to catch.

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

// Strikethrough is a GFM extension the pinned CommonMark reference does not
// implement, so the differential's normalizer refuses it by design (the corpus's
// own ENUM_ALPHABET omits `~` for the same reason). Skip `~` inputs before the
// differential rather than mapping a construct the reference cannot express.
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
				if (divergence === null) return; // reference-skipped or byte-and-kind-equal
				if (!isDocumentedDivergence(source)) throw new Error(describeUnexpected(divergence));
			}),
			PARAMS
		);
	});

	// Reachability + completeness self-test (culture: a generator that cannot reach
	// the class proves nothing, and an allowlist that excuses everything is
	// vacuously green). Fixed seed so it is a deterministic regression guard: it
	// pins that arbInlineSource still reaches ALL THREE documented classes and that
	// NO divergence falls outside them. A predicate hole or a real fourth-class
	// regression fails this directly, independent of the fresh lane's search.
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

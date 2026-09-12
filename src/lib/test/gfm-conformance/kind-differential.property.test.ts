import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { diffInput, type Divergence } from './differ';
import { explainDivergence, NEUTRALIZATIONS_TRIED, type DivergenceClass } from './excuses';
import { arbInlineSource, freshOrFixedSeed } from '../invariants/arbitraries';

// The semantic oracle the byte-conservation and offset-tiling properties can NOT be:
// they stay green when emphasis is classified into the WRONG kinds, since the bytes
// still tile. Blind spot, by construction: breaking aragonite's code-point read makes it
// CONVERGE with the equally-wrong UTF-16 reference, so astral-flanking regressions are
// the baseline slice ratchet's job (it pins astral inputs as must-diverge), not this.

// The three baseline.json classes are decided per divergence by `excuses.ts` — a random input
// is never in baseline.json, so each class is a rule over the diverging kinds, not a lookup.

// Strikethrough is a GFM extension the pinned CommonMark reference cannot express, so
// `~` inputs are skipped before the differential (the corpus's ENUM_ALPHABET omits it
// for the same reason) rather than mapped to a construct the reference lacks.
function isOutsideBaseline(input: string): boolean {
	return input.includes('~');
}

function describeUnexpected(divergence: Divergence): string {
	return (
		'inline node kinds diverge from commonmark and no deliberate class explains it ' +
		`(tried: ${NEUTRALIZATIONS_TRIED}):\n` +
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
				if (explainDivergence(divergence) === null) {
					throw new Error(describeUnexpected(divergence));
				}
			}),
			PARAMS
		);
	});

	// Reachability + completeness self-test (rules.md: a generator that cannot reach the
	// class proves nothing, and an allowlist that excuses everything is vacuously green).
	// Fixed seed so it is a deterministic guard, not part of the fresh lane's search.
	it('arbInlineSource reaches all three documented classes and no fourth', () => {
		const samples = fc.sample(arbInlineSource, { numRuns: 30000, seed: 424242 });
		const reached: Record<DivergenceClass, number> = {
			'gfm-bare-autolink': 0,
			'image-alt-structure': 0,
			'emphasis-flanking-astral': 0
		};
		const unexplained: string[] = [];
		for (const source of samples) {
			if (isOutsideBaseline(source)) continue;
			const divergence = diffInput(source);
			if (divergence === null) continue;
			const explained = explainDivergence(divergence);
			if (explained === null) unexplained.push(source);
			else reached[explained]++;
		}
		expect(unexplained).toEqual([]);
		expect(Object.keys(reached).filter((name) => reached[name as DivergenceClass] === 0)).toEqual(
			[]
		);
	});
});

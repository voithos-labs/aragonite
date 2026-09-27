import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { diffInput, type Divergence } from './differ';
import { explainDivergence, NEUTRALIZATIONS_TRIED, type DivergenceClass } from './excuses';
import { arbInlineSource, freshOrFixedSeed } from '../invariants/arbitraries';

// Checks inline node kinds, which byte conservation and offset tiling cannot: emphasis with the
// wrong kind still tiles. `excuses.ts` classes each divergence by rule, since a random input is
// never in baseline.json. A broken code-point read would agree with the UTF-16 reference, so the
// baseline slice ratchet, which holds astral inputs as must-diverge, covers astral flanking.

// Strikethrough is a GFM extension the pinned CommonMark reference cannot express, so `~` inputs
// are skipped, as `ENUM_ALPHABET` omits `~`.
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

	// A generator that cannot reach a class proves nothing, and an allowlist that excuses
	// everything is vacuously green; the fixed seed keeps this check deterministic.
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

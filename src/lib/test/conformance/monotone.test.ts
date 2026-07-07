import { it, expect } from 'vitest';
import { diffInput } from './differ';
import { enumerateCorpus, sampleCorpus, loadSpecExamples } from './corpus';
import { parseInline } from '../../core/inline';
import { scanInline } from '../../core/inline/scan';

// For every corpus input where the OLD parser already agrees with the reference,
// the new scanner must agree too — the rework may only fix, never break.
// diffInput returns null for skipped-or-equal; skips are decided reference-side,
// identically for both parsers, so null is a safe "agreed" proxy.
const inputs = [
	...loadSpecExamples().map((e) => e.markdown.replace(/\n$/, '')),
	...enumerateCorpus(3),
	...sampleCorpus(20260706, 2000, 4, 12)
];
const regressions = inputs.filter(
	(i) => diffInput(i, parseInline) === null && diffInput(i, scanInline) !== null
);
it('monotone convergence: no previously-converged input regresses', () => {
	expect(regressions).toEqual([]);
});

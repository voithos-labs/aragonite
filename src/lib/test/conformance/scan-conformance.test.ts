import { describe, it, expect } from 'vitest';
import { runDiff } from './differ';
import { enumerateCorpus, sampleCorpus, loadSpecExamples } from './corpus';
import { scanInline } from '../../core/inline/scan';
import baseline from './scan-baseline.json';

// Pre-cutover convergence ratchet for the scanner, against its own baseline;
// slice.test.ts keeps ratcheting the shipping pipeline until cutover folds the
// two. Image divergences compare by alt STRING (normalize.ts maps our alt to a
// single text child), so GFM autolinks inside an alt are invisible here by design.

const sliceInputs = [
	...loadSpecExamples().map((e) => e.markdown.replace(/\n$/, '')),
	...enumerateCorpus(3),
	...sampleCorpus(20260706, 2000, 4, 12)
];

describe('scan conformance slice ratchet', () => {
	const { divergences, compared } = runDiff(sliceInputs, scanInline);
	const found = new Set(divergences.map((d) => d.input));
	const known = new Set(baseline.entries.map((e) => e.input));

	it('compared a non-trivial corpus', () => {
		expect(compared).toBeGreaterThan(2000);
	});

	it('every divergence is a known baseline entry (new divergence = regression)', () => {
		const fresh = [...found].filter((i) => !known.has(i));
		expect(fresh).toEqual([]);
	});

	it('every baseline entry still diverges (stale entry = ratchet progress, remove it)', () => {
		const stale = [...known].filter((i) => !found.has(i));
		expect(stale).toEqual([]);
	});
});

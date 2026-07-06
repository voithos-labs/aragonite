import { describe, it, expect } from 'vitest';
import { runDiff } from './differ';
import { enumerateCorpus, sampleCorpus, loadSpecExamples } from './corpus';
import baseline from './baseline.json';

const sliceInputs = [
	...loadSpecExamples().map((e) => e.markdown.replace(/\n$/, '')),
	...enumerateCorpus(3),
	...sampleCorpus(20260706, 2000, 4, 12)
];

describe('conformance slice ratchet', () => {
	const { divergences, compared } = runDiff(sliceInputs);
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

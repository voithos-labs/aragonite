/**
 * Container-raw amplification report: Σ(container raw) ÷ serialized doc bytes.
 * Deterministic for a fixed fixture — the logged factors feed baseline.json;
 * the assertion guards that the walk materializes content at least once (a
 * broken walk reads ≤1). Hard ceilings live in counters.test.ts.
 */
import { expect, it } from 'vitest';
import { parse } from '../../core/parser';
import { docByteLength } from '../../perf/instruments';
import { containerRawBytes } from './container-raw-bytes';
import { generateFixture } from './fixtures/generate';

for (const shape of ['nested-containers', 'table-heavy'] as const) {
	for (const bytes of [100_000, 1_000_000]) {
		it(`report: container-raw amplification — ${shape} @ ${bytes}B`, () => {
			const doc = parse(generateFixture(shape, bytes));
			const amplification = containerRawBytes(doc.children) / docByteLength(doc);
			console.log(`${shape} ${bytes}B: container-raw amplification ×${amplification.toFixed(2)}`);
			expect(amplification).toBeGreaterThan(1);
		});
	}
}

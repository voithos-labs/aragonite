/**
 * How many times over the containers store the document's bytes: Σ(container raw) ÷
 * serialized document bytes, logged for `baseline.json`. A report, not a gate: the ceilings live
 * in `counters.test.ts`, and each row here checks only that nested containers were counted.
 */
import { expect, it } from 'vitest';
import { parse } from '../../core/parser';
import { docByteLength } from '../../perf/instruments';
import { containerRawBytes } from './container-raw-bytes';
import { generateDeepNested, generateFixture } from './fixtures/generate';

for (const shape of ['nested-containers', 'table-heavy'] as const) {
	for (const bytes of [100_000]) {
		it(`report: container-raw amplification; ${shape} @ ${bytes}B`, () => {
			const doc = parse(generateFixture(shape, bytes));
			const amplification = containerRawBytes(doc.children) / docByteLength(doc);
			console.log(`${shape} ${bytes}B: container-raw amplification ×${amplification.toFixed(2)}`);
			expect(amplification).toBeGreaterThan(1);
		});
	}
}

// Deep nesting stores the bytes more times the deeper it goes (about the chain length
// divided by 2), which is what rebuilding the ancestors costs per keystroke.
for (const [depth, bytes] of [
	[4, 10_000],
	[8, 10_000],
	[12, 50_000]
] as const) {
	it(`report: container-raw amplification; deep-nested depth ${depth} × ${bytes}B/level`, () => {
		const doc = parse(generateDeepNested(depth, bytes));
		const amplification = containerRawBytes(doc.children) / docByteLength(doc);
		console.log(
			`deep-nested depth ${depth} × ${bytes}B/level: container-raw amplification ×${amplification.toFixed(2)}`
		);
		expect(amplification).toBeGreaterThan(1);
	});
}

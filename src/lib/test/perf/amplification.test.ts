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
import { generateDeepNested, generateFixture } from './fixtures/generate';

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

// Deep-nesting amplification grows with depth (≈ chain length ÷ 2): the write-
// amplification factor an ancestry rebuild pays per keystroke. Reported across
// the verdict's depth × per-level envelope.
for (const [depth, bytes] of [
	[4, 10_000],
	[8, 10_000],
	[12, 50_000]
] as const) {
	it(`report: container-raw amplification — deep-nested depth ${depth} × ${bytes}B/level`, () => {
		const doc = parse(generateDeepNested(depth, bytes));
		const amplification = containerRawBytes(doc.children) / docByteLength(doc);
		console.log(
			`deep-nested depth ${depth} × ${bytes}B/level: container-raw amplification ×${amplification.toFixed(2)}`
		);
		expect(amplification).toBeGreaterThan(1);
	});
}

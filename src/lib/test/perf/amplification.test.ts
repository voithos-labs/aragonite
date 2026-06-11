/**
 * Container-raw amplification report: containers materialize their
 * descendants' raw, so Σ(container raw) ÷ serialized doc bytes measures the
 * storage duplication factor. Deterministic for a fixed fixture — the logged
 * factors feed baseline.json; the assertion guards that the walk materializes
 * content at least once (a broken walk reads ≤1).
 */
import { expect, test } from 'vitest';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { docByteLength } from '../../perf/instruments';
import { generateFixture } from './fixtures/generate';

function containerRawBytes(nodes: CstNode[]): number {
	let total = 0;
	for (const node of nodes) {
		if (node.children) {
			total += node.raw.length;
			total += containerRawBytes(node.children);
		}
	}
	return total;
}

for (const shape of ['nested-containers', 'table-heavy'] as const) {
	for (const bytes of [100_000, 1_000_000]) {
		test(`report: container-raw amplification — ${shape} @ ${bytes}B`, () => {
			const doc = parse(generateFixture(shape, bytes));
			const amplification = containerRawBytes(doc.children) / docByteLength(doc);
			console.log(`${shape} ${bytes}B: container-raw amplification ×${amplification.toFixed(2)}`);
			expect(amplification).toBeGreaterThan(1);
		});
	}
}

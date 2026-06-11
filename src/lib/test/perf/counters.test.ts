/**
 * Machine-independent perf regression pins: byte counts and amplification
 * factors are deterministic for a fixed fixture, so ceilings fail loudly when
 * a change regresses them. Ceilings are measured baseline × ~1.1 — update them
 * deliberately (with a changelog note), never reflexively.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../../core/parser';
import { cloneDocument } from '../../tree-operations/clone';
import { docByteLength } from '../../perf/instruments';
import { containerRawBytes } from './container-raw-bytes';
import { generateFixture } from './fixtures/generate';

describe('perf counter ceilings', () => {
	it('clone preserves serialized byte length exactly', () => {
		const doc = parse(generateFixture('nested-containers', 100_000));
		expect(docByteLength(cloneDocument(doc))).toBe(docByteLength(doc));
	});

	it('ceiling: container-raw amplification on the nested fixture', () => {
		const doc = parse(generateFixture('nested-containers', 100_000));
		const amplification = containerRawBytes(doc.children) / docByteLength(doc);
		// Measured 3.55 (baseline.json); 3.9 ≈ ×1.1 headroom.
		expect(amplification).toBeLessThanOrEqual(3.9);
	});

	it('ceiling: container-raw amplification on the table fixture', () => {
		const doc = parse(generateFixture('table-heavy', 100_000));
		const amplification = containerRawBytes(doc.children) / docByteLength(doc);
		// Measured 1.96 (baseline.json); 2.2 ≈ ×1.1 headroom.
		expect(amplification).toBeLessThanOrEqual(2.2);
	});
});

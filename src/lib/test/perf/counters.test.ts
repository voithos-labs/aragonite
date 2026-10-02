/**
 * Performance checks that do not depend on the machine: byte counts and duplication factors
 * are deterministic for a fixed fixture, so a ceiling fails loudly when a change makes one
 * worse. Each ceiling is the measured baseline times about 1.1; raise one deliberately, with a
 * changelog note, never by reflex.
 */
import { describe, expect, it } from 'vitest';
import type { CstNode } from '../../core/nodes';
import { splitLines } from '../../core/lines';
import { parse } from '../../core/parser';
import { cloneDocument } from '../../tree-operations/clone';
import { rebuildUnsharedChain } from '../../tree-operations/chain-rebuild';
import { createSharingState } from '../../tree-operations/sharing';
import { defaultGrammarView } from '../../schema/block-openers';
import {
	disablePerfInstruments,
	docByteLength,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '../../perf/instruments';
import { containerRawBytes } from './container-raw-bytes';
import { generateDeepNested, generateFixture } from './fixtures/generate';

describe('perf counter ceilings', () => {
	it('clone preserves serialized byte length exactly', () => {
		const doc = parse(generateFixture('nested-containers', 100_000));
		expect(docByteLength(cloneDocument(doc))).toBe(docByteLength(doc));
	});

	it('ceiling: container-raw amplification on the nested fixture', () => {
		const doc = parse(generateFixture('nested-containers', 100_000));
		const amplification = containerRawBytes(doc.children) / docByteLength(doc);
		// Measured 3.55 (baseline.json); 3.9 is about 1.1 times that.
		expect(amplification).toBeLessThanOrEqual(3.9);
	});

	it('ceiling: container-raw amplification on the table fixture', () => {
		const doc = parse(generateFixture('table-heavy', 100_000));
		const amplification = containerRawBytes(doc.children) / docByteLength(doc);
		// Measured 1.96 (baseline.json); 2.2 is about 1.1 times that.
		expect(amplification).toBeLessThanOrEqual(2.2);
	});

	// Miss-analysis: the full-rebuild rows were report-only timings and the one line counter
	// covered a keystroke's splice, so a rebuild reading each line twice passed every gate.
	it('ceiling: line reads per line of a full quote and list item rebuild', () => {
		const doc = parse(generateDeepNested(8, 2_000));
		const chain: CstNode[] = [];
		for (let node: CstNode | undefined = doc.children[0]; node;) {
			chain.push(node);
			node = node.children?.find((child) => child.children);
		}
		resetPerfInstruments();
		enablePerfInstruments();
		try {
			rebuildUnsharedChain(doc, chain, createSharingState(), null, defaultGrammarView);
		} finally {
			disablePerfInstruments();
		}
		const stripLines = chain
			.filter((node) => node.kind === 'blockquote' || node.kind === 'listItem')
			.reduce((sum, node) => sum + splitLines(node.raw).length, 0);
		const perLine = perfSnapshot().stripLinesRead / stripLines;
		// Measured 0.05 (baseline.json): only each list item's opening line is read, every other
		// line being its container's own spelling; 0.06 admits no read more.
		expect(perLine).toBeLessThanOrEqual(0.06);
	});
});

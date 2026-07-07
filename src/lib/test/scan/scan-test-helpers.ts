import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import { scanInline } from '../../core/inline/scan';

// ── Coverage assertions ─────────────────────────────────────────────────────

export function assertTotalCoverage(nodes: InlineNode[], start: number, end: number): void {
	let pos = start;
	for (const n of nodes) {
		expect(n.start).toBe(pos);
		expect(n.end).toBeGreaterThan(n.start);
		pos = n.end;
	}
	expect(pos).toBe(end);
}

export interface MarkerRange {
	start: number;
	end: number;
}

/**
 * Children must cover the parent's range minus its marker slices.
 * Signature is binding for Task 3; implemented red-first when emphasis lands.
 */
export function assertChildCoverage(parent: InlineNode, markerRanges: MarkerRange[]): void {
	throw new Error('assertChildCoverage lands with emphasis (Task 3)');
}

// ── Node builders ───────────────────────────────────────────────────────────

export function textNode(start: number, end: number, text: string): InlineNode {
	return { kind: 'text', start, end, text };
}

export function escapeNode(start: number): InlineNode {
	return { kind: 'escape', start, end: start + 2 };
}

export function hardBreak(start: number, end: number): InlineNode {
	return { kind: 'hardLineBreak', start, end };
}

export function entityNode(start: number, end: number, decoded: string): InlineNode {
	return { kind: 'entityReference', start, end, decoded };
}

export function codeNode(start: number, end: number, text: string): InlineNode {
	return { kind: 'inlineCode', start, end, text };
}

// ── Case runner ─────────────────────────────────────────────────────────────

export type ScanCase = [name: string, raw: string, expected: InlineNode[]];

/** Runs scanInline over the whole input, asserting coverage plus exact nodes. */
export function describeScanCases(family: string, cases: ScanCase[]): void {
	describe(family, () => {
		for (const [name, raw, expected] of cases) {
			it(name, () => {
				const nodes = scanInline(raw, 0, raw.length);
				assertTotalCoverage(nodes, 0, raw.length);
				expect(nodes).toEqual(expected);
			});
		}
	});
}

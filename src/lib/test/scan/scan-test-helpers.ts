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

/** Markers plus children must tile the parent's range exactly, in offset order. */
export function assertChildCoverage(parent: InlineNode, markerRanges: MarkerRange[]): void {
	const pieces = [...markerRanges, ...(parent.children ?? [])].sort((a, b) => a.start - b.start);
	let pos = parent.start;
	for (const piece of pieces) {
		expect(piece.start).toBe(pos);
		expect(piece.end).toBeGreaterThan(piece.start);
		pos = piece.end;
	}
	expect(pos).toBe(parent.end);
}

const EMPHASIS_MARKER_LEN: Partial<Record<InlineNode['kind'], number>> = {
	emphasis: 1,
	strong: 2,
	strikethrough: 2
};

/** Every emphasis-family node in the tree tiles as leading marker + children + trailing marker. */
export function assertEmphasisCoverage(nodes: InlineNode[]): void {
	for (const node of nodes) {
		const markerLen = EMPHASIS_MARKER_LEN[node.kind];
		if (markerLen !== undefined) {
			assertChildCoverage(node, [
				{ start: node.start, end: node.start + markerLen },
				{ start: node.end - markerLen, end: node.end }
			]);
		}
		if (node.children) assertEmphasisCoverage(node.children);
	}
}

// ── Tree inspection ─────────────────────────────────────────────────────────

export function hasKind(nodes: InlineNode[], kind: InlineNode['kind']): boolean {
	return nodes.some(
		(n) => n.kind === kind || (n.children !== undefined && hasKind(n.children, kind))
	);
}

export function collectKind(nodes: InlineNode[], kind: InlineNode['kind']): InlineNode[] {
	const out: InlineNode[] = [];
	for (const n of nodes) {
		if (n.kind === kind) out.push(n);
		if (n.children) out.push(...collectKind(n.children, kind));
	}
	return out;
}

/** Node tree rendered as an `<em>`/`<strong>`-tagged shape string for exact pins. */
export function shapeOf(nodes: InlineNode[], source: string): string {
	return nodes
		.map((n) => {
			if (n.kind === 'emphasis') return `<em>${shapeOf(n.children ?? [], source)}</em>`;
			if (n.kind === 'strong') return `<strong>${shapeOf(n.children ?? [], source)}</strong>`;
			return source.slice(n.start, n.end);
		})
		.join('');
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

export function emphasisNode(start: number, end: number, children: InlineNode[]): InlineNode {
	return { kind: 'emphasis', start, end, children };
}

export function strongNode(start: number, end: number, children: InlineNode[]): InlineNode {
	return { kind: 'strong', start, end, children };
}

export function strikethroughNode(start: number, end: number, children: InlineNode[]): InlineNode {
	return { kind: 'strikethrough', start, end, children };
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
				assertEmphasisCoverage(nodes);
				expect(nodes).toEqual(expected);
			});
		}
	});
}

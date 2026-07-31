import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../../../core/nodes';
import { parseInline } from '../../../../core/inline';
import { scanInline } from '../../../../core/inline/scan';
import { __resetInlineSyntaxForTests } from '../../../../core/inline/scan/plugin-syntax';
import {
	normalizeLinkLabel,
	type LinkReferenceResolver,
	type ResolvedReference
} from '../../../../core/inline/link-reference-resolver';

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

const FIXED_MARKER_LEN: Partial<Record<InlineNode['kind'], number>> = {
	emphasis: 1,
	strong: 2
};

// Strikethrough runs are 1 or 2 tildes (cmark-gfm), so its width is derived rather than
// fixed, and checked for symmetry to catch a parser that mis-sized one side.
function emphasisMarkerLen(node: InlineNode): number | undefined {
	const fixed = FIXED_MARKER_LEN[node.kind];
	if (fixed !== undefined) return fixed;
	if (node.kind !== 'strikethrough') return undefined;
	const children = node.children ?? [];
	const interiorStart = children.length > 0 ? children[0].start : node.end;
	const interiorEnd = children.length > 0 ? children[children.length - 1].end : node.start;
	const openLen = interiorStart - node.start;
	const closeLen = node.end - interiorEnd;
	expect(openLen).toBe(closeLen);
	expect(openLen === 1 || openLen === 2).toBe(true);
	return openLen;
}

/**
 * Every emphasis-family, link, and image node tiles as leading marker + children +
 * trailing marker; a link's `](…)` starts where its last child ends, since children
 * cover only the label interior.
 */
export function assertConstructCoverage(nodes: InlineNode[]): void {
	for (const node of nodes) {
		const markerLen = emphasisMarkerLen(node);
		if (markerLen !== undefined) {
			assertChildCoverage(node, [
				{ start: node.start, end: node.start + markerLen },
				{ start: node.end - markerLen, end: node.end }
			]);
		} else if (node.kind === 'link' || node.kind === 'image') {
			const leadEnd = node.start + (node.kind === 'image' ? 2 : 1);
			const children = node.children ?? [];
			const trailStart = children.length > 0 ? children[children.length - 1].end : leadEnd;
			assertChildCoverage(node, [
				{ start: node.start, end: leadEnd },
				{ start: trailStart, end: node.end }
			]);
		}
		if (node.children) assertConstructCoverage(node.children);
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

export function autolinkNode(start: number, end: number, url: string): InlineNode {
	return { kind: 'autolink', start, end, url };
}

export function rawHtmlNode(start: number, end: number): InlineNode {
	return { kind: 'rawHtml', start, end };
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

export function linkNode(
	start: number,
	end: number,
	children: InlineNode[],
	url: string,
	rest: Pick<InlineNode, 'title' | 'label'> = {}
): InlineNode {
	return { kind: 'link', start, end, children, url, ...rest };
}

export function imageNode(
	start: number,
	end: number,
	children: InlineNode[],
	alt: string,
	url: string,
	rest: Pick<InlineNode, 'title' | 'width' | 'height' | 'label'> = {}
): InlineNode {
	return { kind: 'image', start, end, children, alt, url, ...rest };
}

export function unresolvedRefNode(
	start: number,
	end: number,
	label: string,
	refKind: 'link' | 'image'
): InlineNode {
	return { kind: 'unresolvedReference', start, end, label, refKind };
}

// ── Resolver fixture ────────────────────────────────────────────────────────

/** Resolver over a fixed label→reference map, normalizing like the production map. */
export function resolverOf(entries: Record<string, ResolvedReference>): LinkReferenceResolver {
	const map = new Map(Object.entries(entries).map(([k, v]) => [normalizeLinkLabel(k), v]));
	return (label) => map.get(normalizeLinkLabel(label));
}

// ── Case runner ─────────────────────────────────────────────────────────────

/**
 * The empty-registry reading of `raw` — the byte-identity oracle every plugin-rung
 * decline is measured against. Resets first, so a caller can register after taking it.
 */
export function scanClean(raw: string, end = raw.length): InlineNode[] {
	__resetInlineSyntaxForTests();
	return parseInline(raw, 0, end);
}

export type ScanCase = [name: string, raw: string, expected: InlineNode[]];

/** Runs scanInline over the whole input, asserting coverage plus exact nodes. */
export function describeScanCases(
	family: string,
	cases: ScanCase[],
	resolver?: LinkReferenceResolver
): void {
	describe(family, () => {
		for (const [name, raw, expected] of cases) {
			it(name, () => {
				const nodes = scanInline(raw, 0, raw.length, resolver);
				assertTotalCoverage(nodes, 0, raw.length);
				assertConstructCoverage(nodes);
				expect(nodes).toEqual(expected);
			});
		}
	});
}

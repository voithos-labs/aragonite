/**
 * Numbering derived as a pure function over the read-only document: GFM numbers by
 * first-reference order, not definition order. Walking parsed inline nodes rather than
 * raw bytes excludes two things by construction: a `[^x]` in a code span, and a
 * definition's own marker, which lives in the container's raw rather than a child.
 */

import {
	computeInlineContent,
	isProseKind,
	type DocumentView,
	type InlineNode,
	type NodeView
} from '$lib/plugin';
import { FOOTNOTE_REF_KIND } from './constants';

export interface FootnoteReference {
	label: string;
	/** Doc-absolute block path of the prose leaf carrying the reference. */
	path: number[];
}

function forEachLeaf(
	children: readonly NodeView[],
	visit: (leaf: NodeView, path: number[]) => void,
	basePath: number[] = []
): void {
	children.forEach((node, index) => {
		const path = [...basePath, index];
		if (node.children && node.children.length > 0) forEachLeaf(node.children, visit, path);
		else visit(node, path);
	});
}

function collectRefsInInline(
	nodes: readonly InlineNode[],
	path: number[],
	out: FootnoteReference[]
): void {
	for (const node of nodes) {
		if (node.kind === FOOTNOTE_REF_KIND) out.push({ label: node.label ?? '', path });
		else if (node.children) collectRefsInInline(node.children, path, out);
	}
}

export function collectFootnoteReferences(document: DocumentView): FootnoteReference[] {
	const refs: FootnoteReference[] = [];
	forEachLeaf(document.children, (leaf, path) => {
		if (!isProseKind(leaf.kind)) return;
		collectRefsInInline(computeInlineContent(leaf), path, refs);
	});
	return refs;
}

export function assignFootnoteNumbers(document: DocumentView): Map<string, number> {
	const numbers = new Map<string, number>();
	for (const ref of collectFootnoteReferences(document)) {
		if (!numbers.has(ref.label)) numbers.set(ref.label, numbers.size + 1);
	}
	return numbers;
}

// ── Per-version sharing ──────────────────────────────────────────────────────

const numberingByDocument = new WeakMap<
	DocumentView,
	{ version: number; numbers: Map<string, number> }
>();

/**
 * One numbering per flush rather than one per widget. `contentVersion` must be in the key:
 * the `$state` document is mutated in place, so an identity-keyed memo would hit forever and
 * return a stale map.
 */
export function footnoteNumbersFor(
	document: DocumentView,
	contentVersion: number
): Map<string, number> {
	const cached = numberingByDocument.get(document);
	if (cached && cached.version === contentVersion) return cached.numbers;
	const numbers = assignFootnoteNumbers(document);
	numberingByDocument.set(document, { version: contentVersion, numbers });
	return numbers;
}

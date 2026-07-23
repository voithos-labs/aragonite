/**
 * Derived footnote numbering, as a pure function over the read-only document — the
 * single source of truth the reference widget reads for its number. GFM numbers
 * footnotes by first-reference order, not definition order, so the walk visits
 * prose top-to-bottom and assigns a number the first time each label is referenced.
 *
 * References are first-class inline nodes (the `[^`-prefix ladder rung), so the
 * walk parses each prose leaf's inline content and collects `footnote-ref` nodes.
 * Two consequences fall out by construction: a `[^x]` inside an inline code span is
 * an `inlineCode` node, never a reference; and a definition's own `[^label]:` marker
 * lives in the container's raw, not a prose child, so it is never counted as a
 * reference of itself.
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

/** Every `[^label]` reference in prose, in document order. */
export function collectFootnoteReferences(document: DocumentView): FootnoteReference[] {
	const refs: FootnoteReference[] = [];
	forEachLeaf(document.children, (leaf, path) => {
		if (!isProseKind(leaf.kind)) return;
		collectRefsInInline(computeInlineContent(leaf), path, refs);
	});
	return refs;
}

/** Label → footnote number, assigned in first-reference order. */
export function assignFootnoteNumbers(document: DocumentView): Map<string, number> {
	const numbers = new Map<string, number>();
	for (const ref of collectFootnoteReferences(document)) {
		if (!numbers.has(ref.label)) numbers.set(ref.label, numbers.size + 1);
	}
	return numbers;
}

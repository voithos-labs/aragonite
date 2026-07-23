/**
 * Derived footnote numbering, as a pure function over the read-only document —
 * the single source of truth Task 3's reference decorations read. GFM numbers
 * footnotes by first-reference order, not definition order, so the scan walks the
 * document top-to-bottom and assigns a number the first time each label is
 * referenced.
 *
 * References are recognized by a text scan (`[^label]`), not the parser — the
 * inline tier cannot claim the `[` trigger, so a reference is never a first-class
 * node. The scan is best-effort over a prose block's raw bytes: it skips code and
 * definition blocks, but a `[^x]` inside an inline code span is a known false
 * positive. An empty (childless) definition is a leaf whose raw still holds its
 * `[^label]:` marker, so `FOOTNOTE_DEF_KIND` stays in the skip set.
 */

import type { DocumentView, NodeView } from '$lib/plugin';
import { FOOTNOTE_DEF_KIND } from './constants';

export interface FootnoteReference {
	label: string;
	/** Doc-absolute block path of the prose leaf carrying the reference. */
	path: number[];
	/** Raw offsets of `[^label]` within that leaf's bytes. */
	start: number;
	end: number;
}

const REFERENCE = /\[\^([^\]\s]+)\]/g;
const SKIP_SCAN = new Set(['fencedCode', 'indentedCode', 'htmlBlock', FOOTNOTE_DEF_KIND]);

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

/** Every `[^label]` occurrence in prose, in document order. */
export function collectFootnoteReferences(document: DocumentView): FootnoteReference[] {
	const refs: FootnoteReference[] = [];
	forEachLeaf(document.children, (node, path) => {
		if (SKIP_SCAN.has(node.kind)) return;
		for (const match of node.raw.matchAll(REFERENCE)) {
			const start = match.index ?? 0;
			refs.push({ label: match[1], path, start, end: start + match[0].length });
		}
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

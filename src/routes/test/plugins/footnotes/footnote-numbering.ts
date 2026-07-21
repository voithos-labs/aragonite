/**
 * Derived footnote numbering, as a pure function over the read-only document —
 * the single source of truth both the definition component and the reference
 * decoration source read. GFM numbers footnotes by first-reference order, not
 * definition order, so the scan walks the document top-to-bottom and assigns a
 * number the first time each label is referenced.
 *
 * References are recognized by a text scan (`[^label]`) rather than the parser —
 * the inline tier cannot claim the `[` trigger (see the wall log), so the
 * reference is never a first-class node. The scan is therefore best-effort over
 * a prose block's raw bytes: it skips code blocks and definition blocks, but a
 * `[^x]` inside an inline code span is a known false positive.
 */

import type { DocumentView, ReplaceDecoration } from '$lib/plugin';
import { forEachLeaf } from '../walk-views';
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

/**
 * Replace decorations overlaying each reference with its superscript number. The
 * `[^label]` bytes stay in the document (a replace island hides but preserves
 * them), so round-trip holds. The number rides the class so a renumber forces a
 * re-render — decoration widget identity is class-keyed, not object-keyed.
 */
export function footnoteReferenceDecorations(document: DocumentView): ReplaceDecoration[] {
	const numbers = assignFootnoteNumbers(document);
	return collectFootnoteReferences(document).map((ref) => {
		const number = numbers.get(ref.label) ?? 0;
		return {
			type: 'replace',
			path: ref.path,
			start: ref.start,
			end: ref.end,
			class: `footnote-ref footnote-ref-${number}`,
			widget: { buildDom: () => buildReferenceSup(number) }
		};
	});
}

function buildReferenceSup(number: number): HTMLElement {
	const sup = document.createElement('sup');
	sup.className = 'footnote-ref-marker';
	sup.textContent = String(number);
	return sup;
}

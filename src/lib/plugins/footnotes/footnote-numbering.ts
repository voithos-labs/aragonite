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

function collectRefsInSubtree(node: NodeView, basePath: number[], out: FootnoteReference[]): void {
	if (node.children && node.children.length > 0) {
		node.children.forEach((child, index) => collectRefsInSubtree(child, [...basePath, index], out));
		return;
	}
	if (!isProseKind(node.kind)) return;
	collectRefsInInline(computeInlineContent(node), basePath, out);
}

export function collectFootnoteReferences(document: DocumentView): FootnoteReference[] {
	const refs: FootnoteReference[] = [];
	const children = document.children;
	for (let index = 0; index < children.length; index++) {
		for (const ref of subtreeRefs(children[index])) {
			refs.push({ label: ref.label, path: [index, ...ref.path] });
		}
	}
	return refs;
}

/** Labels only, so the numbering a keystroke rebuilds allocates no rebased paths. */
export function assignFootnoteNumbers(document: DocumentView): Map<string, number> {
	const numbers = new Map<string, number>();
	const children = document.children;
	for (let index = 0; index < children.length; index++) {
		for (const ref of subtreeRefs(children[index])) {
			if (!numbers.has(ref.label)) numbers.set(ref.label, numbers.size + 1);
		}
	}
	return numbers;
}

// ── Per-subtree contributions ────────────────────────────────────────────────

interface SubtreeEntry {
	raw: string;
	kind: NodeView['kind'];
	/** Subtree-relative paths; `collectFootnoteReferences` rebases them onto the top-level index. */
	refs: FootnoteReference[];
}

const refsBySubtree = new WeakMap<NodeView, SubtreeEntry>();

/**
 * One top-level subtree's references, memoized against the bytes they came from, so a
 * keystroke re-parses that subtree and reuses every other. Sound because the serializer
 * never recurses (`editor.md` § 12): a subtree's `raw` is its whole byte image, kept so by
 * the container-`raw` rebuild up the ancestry. Bytes, not node identity — copy-on-write
 * mints a new node only on a typing batch's FIRST keystroke (`tree-operations/sharing.ts`).
 */
function subtreeRefs(node: NodeView): readonly FootnoteReference[] {
	const cached = refsBySubtree.get(node);
	if (cached && cached.raw === node.raw && cached.kind === node.kind) return cached.refs;
	const refs: FootnoteReference[] = [];
	collectRefsInSubtree(node, [], refs);
	refsBySubtree.set(node, { raw: node.raw, kind: node.kind, refs });
	return refs;
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

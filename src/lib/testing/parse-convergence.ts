/**
 * The parse-convergence oracle — the live-tree corruption check the byte
 * round-trip only pretended to be.
 *
 * `serialize(parse(serialize(live))) === serialize(live)` is a TAUTOLOGY: G2.1
 * proves `serialize∘parse` is identity for every valid GFM string, so asserting
 * it after a mutation can never fail — a blindness that admitted three
 * live-tree-vs-raw divergence bugs (split-separator-class, typed-cell-pipe,
 * join-paste-stale-kind). This compares the LIVE tree against
 * `parse(serialize(live))` STRUCTURALLY — node kinds, children shape, and each
 * kind's parse-derived metadata — so a node whose raw serializes one way while
 * its live kind/metadata says another is caught.
 *
 * Tolerated transients: the editor holds empty-paragraph placeholders (an empty
 * list item's focusable leaf, a blockquote's trailing blank line, an empty split
 * half) that the parser folds into trivia. Both trees drop empty-paragraph
 * placeholders before comparison — the same tolerance `stale-raw.test.ts` and
 * `structural-id-ref-alignment.test.ts` document, expressed structurally rather
 * than through a byte concat. The tolerance is defined by what the parser folds,
 * so it asks the parser's own blank-line rule (GFM §2.1) rather than a whitespace
 * test of its own: a wider one drops a paragraph the parser would keep, from the
 * live side only, and reports convergence for a tree that diverges.
 *
 * The reparse runs through the ambient parser's registered grammar. Run it only
 * over a doc whose kinds are registered (built-ins always are; a plugin kind
 * needs its opener live) — an unrecognized kind reparses to a paragraph and
 * reads as a false divergence.
 */

import type { BlockMetadataByKind, CstNode, Document } from '../core/nodes';
import { splitLines } from '../core/lines';
import { isBlankLine, parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { show } from './conformance-core';

// Parse-derived metadata fields per kind, typed against BlockMetadataByKind so a
// renamed or removed field is a compile error here. An ADDED field still needs
// enrolling by hand — the type cannot know which new fields are parse-derived.
// Editor-level fields (childIds, ownerEpoch) are not parse-derived, so they stay
// absent — the reparse never mints them.
const METADATA_FIELDS: {
	[K in keyof BlockMetadataByKind]?: readonly (keyof BlockMetadataByKind[K])[];
} = {
	heading: ['level'],
	setextHeading: ['level'],
	fencedCode: ['fenceMarker', 'fenceLength', 'info', 'closed'],
	thematicBreak: ['marker'],
	linkReferenceDefinition: ['label', 'url', 'title'],
	table: ['columnCount', 'alignments'],
	tableRow: ['isHeader'],
	blockquote: ['quoteDepth'],
	list: ['ordered'],
	listItem: ['marker', 'taskItem', 'taskChecked', 'taskMarker']
};

/** An empty-paragraph placeholder the parser folds into trivia — a tolerated transient. */
function isEmptyParagraphPlaceholder(node: CstNode): boolean {
	if (node.kind !== 'paragraph' || node.children) return false;
	return splitLines(node.raw).every((line) => isBlankLine(line.text));
}

/** Children with the tolerated empty-paragraph placeholders dropped, both sides symmetrically. */
function comparableChildren(node: Document | CstNode): CstNode[] {
	return (node.children ?? []).filter((c) => !isEmptyParagraphPlaceholder(c));
}

/** True when the live tree converges structurally with a fresh parse of its serialization. */
export function parseConverges(doc: Document): boolean {
	return describeConvergence(doc) === null;
}

/**
 * The FIRST structural divergence between the live tree and
 * `parse(serialize(doc))`, or null when they converge.
 */
export function describeConvergence(doc: Document): string | null {
	return diffChildren(doc, parse(serialize(doc)), []);
}

/** Assert convergence, throwing a plain `Error` (runner-agnostic) on divergence. */
export function assertParseConverged(doc: Document, label = 'parse convergence'): void {
	const divergence = describeConvergence(doc);
	if (divergence) throw new Error(`${label}: ${divergence}`);
}

function diffChildren(
	live: Document | CstNode,
	reparsed: Document | CstNode,
	path: number[]
): string | null {
	const liveKids = comparableChildren(live);
	const reKids = comparableChildren(reparsed);
	if (liveKids.length !== reKids.length) {
		return `[${path.join(',')}] live has ${liveKids.length} comparable children, reparsed has ${reKids.length}`;
	}
	for (let i = 0; i < liveKids.length; i++) {
		const divergence = diffNode(liveKids[i], reKids[i], [...path, i]);
		if (divergence) return divergence;
	}
	return null;
}

function diffNode(live: CstNode, reparsed: CstNode, path: number[]): string | null {
	const at = `[${path.join(',')}]`;
	if (live.kind !== reparsed.kind) {
		return `${at} live kind "${live.kind}" != reparsed "${reparsed.kind}"`;
	}
	const metaDivergence = diffMetadata(live, reparsed, at);
	if (metaDivergence) return metaDivergence;
	return diffChildren(live, reparsed, path);
}

function diffMetadata(live: CstNode, reparsed: CstNode, at: string): string | null {
	const fields = METADATA_FIELDS[live.kind as keyof BlockMetadataByKind];
	if (!fields) return null;
	const liveMeta = (live.metadata ?? {}) as Record<string, unknown>;
	const reMeta = (reparsed.metadata ?? {}) as Record<string, unknown>;
	for (const field of fields) {
		if (!valuesEqual(liveMeta[field], reMeta[field])) {
			return `${at} ${live.kind}.${field}: live ${show(liveMeta[field])} != reparsed ${show(reMeta[field])}`;
		}
	}
	return null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => v === b[i]);
	}
	return a === b;
}

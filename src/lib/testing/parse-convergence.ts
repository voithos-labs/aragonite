/**
 * The parse-convergence oracle. A byte round-trip after a mutation is a tautology (G2.1
 * makes `serialize∘parse` identity), so this compares the LIVE tree against
 * `parse(serialize(live))` STRUCTURALLY instead: kinds, children shape, and parse-derived
 * metadata. The comparison is exact — since 0.9.36 the parser materializes blank lines as
 * blocks, so an empty paragraph reparses as itself. The reparse uses the ambient grammar,
 * so an unregistered kind reads as a false divergence.
 */

import type { BlockMetadataByKind, CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { show } from './conformance-core';

// Typed against BlockMetadataByKind so a renamed or removed field is a compile error;
// an ADDED field still needs enrolling by hand. Editor-level fields (childIds,
// ownerEpoch) are not parse-derived, so the reparse never mints them.
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

/** True when the live tree converges structurally with a fresh parse of its serialization. */
export function parseConverges(doc: Document): boolean {
	return describeConvergence(doc) === null;
}

/** The FIRST structural divergence from `parse(serialize(doc))`, or null when converged. */
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
	const liveKids = live.children ?? [];
	const reKids = reparsed.children ?? [];
	if (liveKids.length !== reKids.length) {
		return `[${path.join(',')}] live has ${liveKids.length} children, reparsed has ${reKids.length}`;
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

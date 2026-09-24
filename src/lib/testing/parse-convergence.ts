/**
 * Compares the live tree against `parse(serialize(live))`. A byte round-trip after a mutation is
 * trivially true (G2.1 makes `serialize∘parse` the identity), so this compares structure instead:
 * kinds, the shape of the children, and the metadata the parser derives. The comparison is exact,
 * because the parser turns blank lines into blocks, so an empty paragraph reparses as itself. The
 * reparse uses `grammar`, the registered one by default: pass the editor's own when it has one.
 */

import type { BlockMetadataByKind, CstNode, Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { show } from './conformance-core';

// Typed against BlockMetadataByKind so a renamed or removed field is a compile error; a field
// that is added still has to be listed here by hand. Fields the editor adds (childIds,
// ownerEpoch) do not come from the parser, so a reparse never produces them.
const METADATA_FIELDS: {
	[K in keyof BlockMetadataByKind]?: readonly (keyof BlockMetadataByKind[K])[];
} = {
	heading: ['level'],
	setextHeading: ['level'],
	fencedCode: ['fenceMarker', 'fenceLength', 'info', 'closed'],
	thematicBreak: ['marker'],
	linkReferenceDefinition: ['label', 'url', 'title'],
	table: ['columnCount', 'alignments'],
	tableRow: ['isHeader', 'surplusCells'],
	blockquote: ['quoteDepth'],
	list: ['ordered'],
	listItem: ['marker', 'taskItem', 'taskChecked', 'taskMarker']
};

/** True when the live tree matches a fresh parse of its own serialization, structurally. */
export function parseConverges(doc: Document, grammar?: GrammarView): boolean {
	return describeConvergence(doc, grammar) === null;
}

/** The first structural difference from `parse(serialize(doc))`, or null when they match. */
export function describeConvergence(doc: Document, grammar?: GrammarView): string | null {
	return diffChildren(doc, parse(serialize(doc), { grammar }), []);
}

/** Asserts the two match, throwing a plain `Error` on a difference so any runner can use it. */
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

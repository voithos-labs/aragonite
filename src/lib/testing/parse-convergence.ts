/**
 * Compares the live tree's structure (kinds, children, every metadata key) with a fresh parse
 * of its own bytes; a byte round-trip would pass trivially, since `serialize(parse(s)) === s` for
 * every input. `parseConverges` and `describeConvergence` take the editor's `grammar` when it
 * has one; `assertParseConverged` reads with the default grammar.
 */

import type { CstNode, Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { describeMetadataDivergence } from '../invariants/metadata-parity';

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
	const metaDivergence = describeMetadataDivergence(live, reparsed);
	if (metaDivergence) return `${at} ${metaDivergence}`;
	return diffChildren(live, reparsed, path);
}

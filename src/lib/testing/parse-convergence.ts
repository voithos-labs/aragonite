/**
 * Compares the live tree's structure (kinds, children, every metadata key) with a fresh parse
 * of its own bytes; a byte round-trip would pass trivially, since `serialize(parse(s)) === s` for
 * every input. `parseConverges` and `describeConvergence` take the editor's `grammar` when it
 * has one; `assertParseConverged` reads with the default grammar.
 */

import type { Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { describeShapeDivergence } from '../core/shape-divergence';

/** True when the live tree matches a fresh parse of its own serialization, structurally. */
export function parseConverges(doc: Document, grammar?: GrammarView): boolean {
	return describeConvergence(doc, grammar) === null;
}

/** The first structural difference from `parse(serialize(doc))`, or null when they match. */
export function describeConvergence(doc: Document, grammar?: GrammarView): string | null {
	return describeShapeDivergence(doc, parse(serialize(doc), { grammar }));
}

/** Asserts the two match, throwing a plain `Error` on a difference so any runner can use it. */
export function assertParseConverged(doc: Document, label = 'parse convergence'): void {
	const divergence = describeConvergence(doc);
	if (divergence) throw new Error(`${label}: ${divergence}`);
}

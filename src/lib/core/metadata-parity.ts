/**
 * Whether a node's metadata is what a parse of its own bytes derives, key by key. The
 * parse-convergence check and the opaque stale-raw check both compare through here.
 */

import type { NodeView } from '../core/node-views';

/** The first metadata key whose live value differs from the reparse's, described, or null. */
export function describeMetadataDivergence(live: NodeView, reparsed: NodeView): string | null {
	const liveMeta = (live.metadata ?? {}) as Record<string, unknown>;
	const reMeta = (reparsed.metadata ?? {}) as Record<string, unknown>;
	for (const key of new Set([...Object.keys(liveMeta), ...Object.keys(reMeta)])) {
		if (!valuesEqual(liveMeta[key], reMeta[key])) {
			return `${live.kind}.${key}: live ${showValue(liveMeta[key])} != reparsed ${showValue(reMeta[key])}`;
		}
	}
	return null;
}

/** A value as a failure message quotes it: strings quoted, everything else as `String` prints it. */
export function showValue(value: unknown): string {
	return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => v === b[i]);
	}
	return a === b;
}

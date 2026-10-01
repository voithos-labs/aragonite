/**
 * Where two trees' block shapes part: kinds, child counts, and every metadata key, compared
 * depth first. Bytes aren't compared, since a node's bytes always round-trip.
 */

import type { NodeView } from './node-views';
import { describeMetadataDivergence } from './metadata-parity';

interface ShapeParent {
	readonly children?: readonly NodeView[];
}

/** The first difference between the children of `live` and `reparsed`, with the path it sits
 *  at below `path`, or null when they match. */
export function describeShapeDivergence(
	live: ShapeParent,
	reparsed: ShapeParent,
	path: readonly number[] = []
): string | null {
	const liveKids = live.children ?? [];
	const reKids = reparsed.children ?? [];
	if (liveKids.length !== reKids.length) {
		return `[${path.join(',')}] live has ${liveKids.length} children, reparsed has ${reKids.length}`;
	}
	for (let i = 0; i < liveKids.length; i++) {
		const at = [...path, i];
		const divergence = nodeDivergence(liveKids[i], reKids[i], at);
		if (divergence) return divergence;
	}
	return null;
}

function nodeDivergence(live: NodeView, reparsed: NodeView, path: number[]): string | null {
	const at = `[${path.join(',')}]`;
	if (live.kind !== reparsed.kind) {
		return `${at} live kind "${live.kind}" != reparsed "${reparsed.kind}"`;
	}
	const metaDivergence = describeMetadataDivergence(live, reparsed);
	if (metaDivergence) return `${at} ${metaDivergence}`;
	return describeShapeDivergence(live, reparsed, path);
}

import type { DocumentView, NodeView } from '../core/node-views';
import { getBlockKindDescriptor, type BlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { CompiledMatcher, RawRange } from './matcher';

/** `start`/`end` are raw offsets into the matched block's own raw (public
 *  surface, so they stay `number`; DOM entry points mint). */
export interface Match {
	path: number[];
	start: number;
	end: number;
	groups?: string[];
}

// A childless opaque container has no leaves to carry its text, so its own raw matches like
// a leaf. Strip/grid containers stay walk-only even when empty: their raw is marker syntax.
const scansOwnRaw = (node: NodeView, desc: BlockKindDescriptor): boolean =>
	desc.containerContract === 'opaque' && (node.children?.length ?? 0) === 0;

/** One searchable leaf: the text a scan reads and the path its matches carry. */
export interface ScanTarget {
	path: number[];
	raw: string;
}

/** The searchable leaves in document order. Split out from matching so one target list can
 *  be matched here or shipped to the off-thread executor and re-joined against its ranges. */
export function collectScanTargets(doc: DocumentView): ScanTarget[] {
	const out: ScanTarget[] = [];
	const walk = (nodes: readonly NodeView[], prefix: number[]): void => {
		nodes.forEach((node, i) => {
			const path = [...prefix, i];
			const desc = getBlockKindDescriptor(node.kind);
			if (desc.isContainer && !scansOwnRaw(node, desc)) {
				walk(node.children ?? [], path);
				return; // container raw duplicates child content; only leaves carry text
			}
			if (!desc.editable) return; // thematicBreak and other non-editable kinds have no searchable text
			out.push({ path, raw: node.raw });
		});
	};
	walk(doc.children, []);
	return out;
}

/** Joins per-target ranges back onto their paths, positionally — the ranges must
 *  come from the same target list, in the same order. */
export function matchesFromRanges(
	targets: readonly ScanTarget[],
	perTarget: readonly RawRange[][]
): Match[] {
	const out: Match[] = [];
	targets.forEach((target, i) => {
		for (const r of perTarget[i] ?? []) {
			out.push({ path: target.path, start: r.start, end: r.end, groups: r.groups });
		}
	});
	return out;
}

export function scanDocument(doc: DocumentView, matcher: CompiledMatcher): Match[] {
	const targets = collectScanTargets(doc);
	return matchesFromRanges(
		targets,
		targets.map((t) => matcher.findAll(t.raw))
	);
}

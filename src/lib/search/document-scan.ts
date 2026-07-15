import type { Document, CstNode } from '../core/nodes';
import { getBlockKindDescriptor, type BlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { CompiledMatcher } from './matcher';

/** `start`/`end` are raw offsets into the matched block's own raw (public
 *  surface, so they stay `number`; DOM entry points mint). */
export interface Match {
	path: number[];
	start: number;
	end: number;
	groups?: string[];
}

// A childless opaque container (e.g. a diagram block) has no leaves to carry its
// text — its own raw is the only carrier, so it matches like a leaf. Strip/grid
// containers stay walk-only even when empty: their raw is marker syntax.
const scansOwnRaw = (node: CstNode, desc: BlockKindDescriptor): boolean =>
	desc.containerContract === 'opaque' && (node.children?.length ?? 0) === 0;

export function scanDocument(doc: Document, matcher: CompiledMatcher): Match[] {
	const out: Match[] = [];
	const walk = (nodes: CstNode[], prefix: number[]): void => {
		nodes.forEach((node, i) => {
			const path = [...prefix, i];
			const desc = getBlockKindDescriptor(node.kind);
			if (desc.isContainer && !scansOwnRaw(node, desc)) {
				walk(node.children ?? [], path);
				return; // container raw duplicates child content; only leaves carry text
			}
			if (!desc.editable) return; // thematicBreak and other non-editable kinds have no searchable text
			for (const r of matcher.findAll(node.raw)) {
				out.push({ path, start: r.start, end: r.end, groups: r.groups });
			}
		});
	};
	walk(doc.children, []);
	return out;
}

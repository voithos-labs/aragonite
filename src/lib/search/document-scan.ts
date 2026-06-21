import type { Document, CstNode } from '../core/nodes';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { CompiledMatcher } from './matcher';

export interface Match {
	path: number[];
	start: number;
	end: number;
	groups?: string[];
}

export function scanDocument(doc: Document, matcher: CompiledMatcher): Match[] {
	const out: Match[] = [];
	const walk = (nodes: CstNode[], prefix: number[]): void => {
		nodes.forEach((node, i) => {
			const path = [...prefix, i];
			const desc = getBlockKindDescriptor(node.kind);
			if (desc.isContainer) {
				walk(node.children ?? [], path);
				return; // container raw duplicates child content; only leaves carry text
			}
			if (!desc.editable) return; // thematicBreak and other non-editable leaves have no searchable text
			for (const r of matcher.findAll(node.raw)) {
				out.push({ path, start: r.start, end: r.end, groups: r.groups });
			}
		});
	};
	walk(doc.children, []);
	return out;
}

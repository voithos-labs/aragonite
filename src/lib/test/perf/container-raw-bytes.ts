import type { CstNode } from '../../core/nodes';

// Containers materialize their descendants' raw, so summing container raw
// across the tree measures the CST's storage duplication.
export function containerRawBytes(nodes: CstNode[]): number {
	let total = 0;
	for (const node of nodes) {
		if (node.children) {
			total += node.raw.length;
			total += containerRawBytes(node.children);
		}
	}
	return total;
}

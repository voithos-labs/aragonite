import type { CstNode } from '../../core/nodes';

// A container holds its descendants' raw too, so summing every container's raw across the
// tree measures how many times over the CST stores the same bytes.
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

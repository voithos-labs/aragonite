import type { NodeView } from '$lib/plugin';

// Shared leaf walk for the demo and fixture plugins these routes install, kept to this one
// traversal so each plugin still reads as a self-contained authoring example.
export function forEachLeaf(
	children: readonly NodeView[],
	visit: (leaf: NodeView, path: number[]) => void,
	basePath: number[] = []
): void {
	children.forEach((node, index) => {
		const path = [...basePath, index];
		if (node.children && node.children.length > 0) {
			forEachLeaf(node.children, visit, path);
		} else {
			visit(node, path);
		}
	});
}

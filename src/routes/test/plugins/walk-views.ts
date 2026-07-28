import type { NodeView } from '$lib/plugin';

// Shared leaf walk for the route fixture plugins: descends `node.children`,
// building each node's doc-absolute path, and calls `visit` on every leaf (a node
// with no child blocks). Kept fixtures-local so each plugin stays a self-contained
// authoring example apart from this one traversal.
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

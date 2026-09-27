/** Traversals of the block tree by path. */

import type { CstNode, Document } from './nodes';
import type { DocumentView, NodeView } from './node-views';

type WalkControl = void | 'skip' | 'stop';
type Parent<N> = { readonly children?: readonly N[] };

/** Every block under `root`, not `root` itself, parents first; each path starts with `basePath` and
 *  is the visitor's to keep. `'skip'` leaves out a node's children; `'stop'` ends it, returning true. */
export function walkBlocks(
	root: Document | CstNode,
	visit: (node: CstNode, path: number[]) => WalkControl,
	basePath?: readonly number[]
): boolean;
export function walkBlocks(
	root: DocumentView | NodeView,
	visit: (node: NodeView, path: number[]) => WalkControl,
	basePath?: readonly number[]
): boolean;
export function walkBlocks<N extends Parent<N>>(
	root: Parent<N>,
	visit: (node: N, path: number[]) => WalkControl,
	basePath: readonly number[] = []
): boolean {
	return walkChildren(root.children, [...basePath], visit);
}

/** The blocks strictly between `root` and the block at `path`, outermost first; the steps past a
 *  missing child are left out. */
export function ancestorsOf(root: Document | CstNode, path: readonly number[]): CstNode[];
export function ancestorsOf(root: DocumentView | NodeView, path: readonly number[]): NodeView[];
export function ancestorsOf(root: DocumentView | NodeView, path: readonly number[]): NodeView[] {
	const ancestors: NodeView[] = [];
	let children = root.children;
	for (const index of path.slice(0, -1)) {
		const node = children?.[index];
		if (!node) break;
		ancestors.push(node);
		children = node.children;
	}
	return ancestors;
}

// `trail` is the traversal's own path, copied for each visit so a visitor's array stays its own.
function walkChildren<N extends Parent<N>>(
	children: readonly N[] | undefined,
	trail: number[],
	visit: (node: N, path: number[]) => WalkControl
): boolean {
	if (!children) return false;
	for (let index = 0; index < children.length; index++) {
		trail.push(index);
		const control = visit(children[index], trail.slice());
		const stopped =
			control === 'stop' ||
			(control !== 'skip' && walkChildren(children[index].children, trail, visit));
		trail.pop();
		if (stopped) return true;
	}
	return false;
}

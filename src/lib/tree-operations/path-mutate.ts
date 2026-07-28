/**
 * Path-addressed child splices for the range-delete ceremony. Both go through
 * `spliceChildren`, the lockstep door: these address a container at arbitrary
 * depth, which is exactly where a desynced `childIds` becomes permanent (see
 * children.ts).
 */
import type { CstNode, Document } from '../core/nodes';
import { spliceChildren } from './children';
import { nodeAt } from './node-ops';

export function deleteAtPath(doc: Document, path: number[]): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	if (idx < parent.children.length) {
		spliceChildren(parent as CstNode, idx, 1);
	}
}

export function replaceAtPath(doc: Document, path: number[], replacement: CstNode[]): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	spliceChildren(parent as CstNode, idx, 1, ...replacement);
}

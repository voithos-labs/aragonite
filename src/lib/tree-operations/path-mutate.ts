import type { CstNode, Document } from '../core/nodes';
import { nodeAt } from './node-ops';

export function deleteAtPath(doc: Document, path: number[]): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	if (idx < parent.children.length) {
		parent.children.splice(idx, 1);
	}
}

export function replaceAtPath(doc: Document, path: number[], replacement: CstNode[]): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	parent.children.splice(idx, 1, ...replacement);
}

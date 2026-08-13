/**
 * Path-addressed child splices for the range-delete ceremony. Both route through
 * `spliceChildrenSettled` (`node-ops.ts`): they address containers at arbitrary depth, which is
 * exactly where a desynced `childIds` or an unsettled separator becomes permanent.
 */
import type { CstNode, Document } from '../core/nodes';
import type { SharingState } from './sharing';
import { nodeAt, spliceChildrenSettled } from './node-ops';

export function deleteAtPath(doc: Document, path: number[], sharing?: SharingState): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	if (idx < parent.children.length) {
		spliceChildrenSettled(parent, idx, 1, [], sharing);
	}
}

export function replaceAtPath(
	doc: Document,
	path: number[],
	replacement: CstNode[],
	sharing?: SharingState
): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	spliceChildrenSettled(parent, path[path.length - 1], 1, replacement, sharing);
}

/**
 * Path-addressed child splices for the range delete. Both go through `spliceChildrenSettled`
 * (`settle.ts`): they address containers at any depth, exactly where a drifted `childIds` or a
 * stale separator becomes permanent. `sharing` is required, not optional: the fix-up writes the
 * surviving neighbours' own bytes, and without it those writes hit snapshot-shared nodes (G1.9).
 * Callers copy the parent chain themselves; `sharing` copies the children the fix-up touches.
 */
import type { CstNode, Document } from '../core/nodes';
import type { SharingState } from './sharing';
import { nodeAt } from './node-primitives';
import { spliceChildrenSettled } from './settle';

export function deleteAtPath(doc: Document, path: number[], sharing: SharingState): void {
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
	sharing: SharingState
): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	spliceChildrenSettled(parent, path[path.length - 1], 1, replacement, sharing);
}

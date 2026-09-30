/**
 * Path-addressed child splices for the range delete, through `spliceChildrenSettled` so a
 * container at any depth keeps its `childIds` and separators right. `sharing` is required, since
 * the fix-up writes neighbours' bytes that an undo snapshot may share (G1.9). Callers copy the
 * parent chain themselves; `sharing` copies the children the fix-up touches.
 */
import type { CstNode, Document } from '../core/nodes';
import { documentLineEnding } from '../core/lines';
import type { GrammarView } from '../schema/block-openers';
import type { SharingState } from './sharing';
import { nodeAt } from './node-primitives';
import { spliceChildrenSettled } from './settle';

export function deleteAtPath(
	doc: Document,
	path: number[],
	sharing: SharingState,
	grammar: GrammarView
): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	if (idx < parent.children.length) {
		spliceChildrenSettled(parent, idx, 1, [], grammar, sharing, documentLineEnding(doc));
	}
}

export function replaceAtPath(
	doc: Document,
	path: number[],
	replacement: CstNode[],
	sharing: SharingState,
	grammar: GrammarView
): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const at = path[path.length - 1];
	spliceChildrenSettled(parent, at, 1, replacement, grammar, sharing, documentLineEnding(doc));
}

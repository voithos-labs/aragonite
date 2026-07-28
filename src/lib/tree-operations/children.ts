/**
 * Container children mutations that keep `childIds` in lockstep, for
 * out-of-commit-scope writes (discovered descendants/ancestors — see
 * node-ops.ts header). Inside a commit scope the StructuralChange descriptor
 * owns id/ref sync; these helpers cover the spots it can't reach, where a
 * hand-rolled splice would let the parallel id array drift and break
 * Svelte's keyed-each rendering.
 */

import type { CstNode } from '../core/nodes';
import { assignIds, generateBlockId } from '../block-id';

export function pushChild(container: CstNode, child: CstNode): void {
	if (!container.children) container.children = [];
	// Lazy-init (unlike spliceChildren): M1 pushes into containers assembled
	// mid-merge that may not have mounted yet, so the parallel array must
	// exist before the push or the new child's id is silently dropped.
	if (!container.childIds) container.childIds = assignIds(container.children);
	container.children.push(child);
	container.childIds.push(generateBlockId());
}

/**
 * Bring `childIds` back to `children`'s length after an in-place children swap
 * (the reparse branches, which replace the array wholesale rather than splicing).
 * The surviving prefix keeps its ids: a blanket re-mint would remount every child
 * of the container under Svelte's keyed each, which is exactly the identity those
 * branches exist to preserve. No-op when the container never had the array —
 * the mounting BlockList backfills an absent one.
 */
export function resyncChildIds(container: CstNode): void {
	const ids = container.childIds;
	if (!ids) return;
	if (!container.children) {
		container.childIds = undefined;
		return;
	}
	const count = container.children.length;
	if (ids.length > count) ids.length = count;
	for (let i = ids.length; i < count; i++) ids.push(generateBlockId());
}

export function spliceChildren(
	container: CstNode,
	at: number,
	removeCount: number,
	...items: CstNode[]
): void {
	if (!container.children) container.children = [];
	// No lazy-init here: containers without childIds get them from the mounting BlockList anyway.
	if (container.childIds) {
		container.childIds.splice(at, removeCount, ...items.map(() => generateBlockId()));
	}
	container.children.splice(at, removeCount, ...items);
}

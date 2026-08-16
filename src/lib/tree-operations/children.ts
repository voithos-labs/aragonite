/**
 * Container children mutations that keep `childIds` in lockstep, for out-of-commit-scope
 * writes (discovered descendants/ancestors — see the `node-ops.ts` header). Inside a
 * commit scope the StructuralChange descriptor owns id/ref sync; here a hand-rolled
 * splice would let the parallel id array drift and break Svelte's keyed-each rendering.
 */

import type { CstNode } from '../core/nodes';
import { assignIds, generateBlockId } from '../block-id';

export function pushChild(container: CstNode, child: CstNode): void {
	if (!container.children) container.children = [];
	// Lazy-init (unlike spliceChildren): pushes land in containers assembled mid-merge that
	// may not have mounted yet, so the parallel array must exist or the new id is dropped.
	if (!container.childIds) container.childIds = assignIds(container.children);
	container.children.push(child);
	container.childIds.push(generateBlockId());
}

/**
 * Bring `childIds` back to `children`'s length after an in-place children swap. The
 * surviving prefix keeps its ids — a blanket re-mint would remount every child under
 * Svelte's keyed each, the identity the swapping branches exist to preserve. No-op when
 * the array is absent; the mounting BlockList backfills it.
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
		// A replacement's head continues the slot it lands in, so it keeps that slot's id —
		// `replacePreservingFirst`'s rule, which the in-commit-scope splice already carries.
		const continues = removeCount > 0 && items.length > 0;
		const ids = items.map((_, i) =>
			i === 0 && continues ? container.childIds![at] : generateBlockId()
		);
		container.childIds.splice(at, removeCount, ...ids);
	}
	container.children.splice(at, removeCount, ...items);
}

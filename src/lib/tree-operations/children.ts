/**
 * Container children mutations that keep `childIds` in lockstep, for
 * out-of-commit-scope writes (discovered descendants/ancestors — see
 * node-ops.ts header). Inside a commit scope the StructuralChange descriptor
 * owns id/ref sync; these helpers cover the spots it can't reach, where a
 * hand-rolled splice would let the parallel id array drift and break
 * Svelte's keyed-each rendering.
 */

import type { CstNode } from '../core/nodes';
import { assignIds, generateBlockId } from './block-id';

export function pushChild(container: CstNode, child: CstNode): void {
	if (!container.children) container.children = [];
	// Lazy-init (unlike spliceChildren): M1 pushes into containers assembled
	// mid-merge that may not have mounted yet, so the parallel array must
	// exist before the push or the new child's id is silently dropped.
	if (!container.childIds) container.childIds = assignIds(container.children);
	container.children.push(child);
	container.childIds.push(generateBlockId());
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

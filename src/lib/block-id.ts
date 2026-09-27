import type { NodeView } from './core/node-views';

// A per-module-instance prefix: a dev-server reload restarts the counter while the live tree
// still holds ids created before it, and a repeat collides in Svelte's keyed each.
const RUN = Math.random().toString(36).slice(2, 8);
let sequence = 0;

/** Keys for Svelte's `{#each}`: unique within the process and cheap per block, not unguessable. */
export function generateBlockId(): string {
	sequence += 1;
	return `b${RUN}-${sequence}`;
}

// `childIds` is the one field safe to write even on a node an undo snapshot shares. Sized from
// `length`, so a `$state` array costs one proxy read, not one per child.
export function assignIds(children: readonly NodeView[]): string[] {
	const ids = new Array<string>(children.length);
	for (let i = 0; i < ids.length; i++) ids[i] = generateBlockId();
	return ids;
}

/** Call before a freshly parsed subtree is spliced in: a reused container reads `childIds` in its
 *  keyed each synchronously, so a missing array shows up as `undefined` keys. */
export function assignChildIdsDeep(node: NodeView): void {
	if (node.children && node.children.length > 0 && !node.childIds) {
		node.childIds = assignIds(node.children);
	}
	for (const child of node.children ?? []) assignChildIdsDeep(child);
}

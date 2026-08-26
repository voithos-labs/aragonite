import type { NodeView } from './core/node-views';

// A per-module-instance prefix: a dev-server reload restarts the counter while the live tree
// still holds ids minted before it, and a repeat collides in Svelte's keyed each.
const RUN = Math.random().toString(36).slice(2, 8);
let sequence = 0;

/**
 * These ids key Svelte's `{#each}`: process uniqueness, not unguessability. `crypto.randomUUID`
 * costs about a microsecond each, which is half a second of a 400,000-block load, and is
 * secure-context-only besides — an embedder on plain http has `crypto` without it.
 */
export function generateBlockId(): string {
	sequence += 1;
	return `b${RUN}-${sequence}`;
}

// View-typed: one id per slot, content never read — and `childIds` is the
// bytes-view carve-out, legal to write even on a snapshot-shared node. Sized off `length`
// rather than mapped, so a `$state` children array costs one proxy read instead of one per slot.
export function assignIds(children: readonly NodeView[]): string[] {
	const ids = new Array<string>(children.length);
	for (let i = 0; i < ids.length; i++) ids[i] = generateBlockId();
	return ids;
}

/**
 * Initialize `childIds` before a freshly-parsed subtree is spliced into the live tree: a
 * reused container reads it in its keyed-each synchronously, so a missing array surfaces
 * as `undefined` keys.
 */
export function assignChildIdsDeep(node: NodeView): void {
	if (node.children && node.children.length > 0 && !node.childIds) {
		node.childIds = assignIds(node.children);
	}
	for (const child of node.children ?? []) assignChildIdsDeep(child);
}

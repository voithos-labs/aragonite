import type { NodeView } from './core/node-views';

let fallbackSequence = 0;

/**
 * `crypto.randomUUID` is secure-context-only, and embedders on plain http (an
 * intranet, a LAN preview) have `crypto` without it. These ids key Svelte's
 * `{#each}`; they need process uniqueness, not unguessability, so the fallback is
 * a sequence — and a missing method must never take down every keyed render.
 */
export function generateBlockId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	fallbackSequence += 1;
	return `block-${fallbackSequence}-${Math.random().toString(36).slice(2)}`;
}

// View-typed: one id per slot, content never read — and `childIds` is the
// bytes-view carve-out, legal to write even on a snapshot-shared node.
export function assignIds(children: readonly NodeView[]): string[] {
	return children.map(() => generateBlockId());
}

/**
 * Initialize `childIds` on every container in a freshly-parsed subtree before it
 * is spliced into the live tree: a reused container component reads `childIds` in
 * its keyed-each synchronously, so a missing array surfaces as `undefined` keys.
 */
export function assignChildIdsDeep(node: NodeView): void {
	if (node.children && node.children.length > 0 && !node.childIds) {
		node.childIds = assignIds(node.children);
	}
	for (const child of node.children ?? []) assignChildIdsDeep(child);
}

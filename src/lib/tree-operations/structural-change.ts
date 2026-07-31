/**
 * Structural-change descriptor returned by tree ops; the commit primitive consumes it to
 * auto-sync the parallel `blockIds` / `blockRefs` arrays, so callers never hand-splice
 * them. Every variant describes ONE contiguous `at`/`count` window — an op editing two
 * disjoint ranges splits into separate commits or uses the multi-scope commit path.
 */

import type { BlockComponent } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { SharingState } from './sharing';
import { generateBlockId, assignChildIdsDeep } from '../block-id';

export type StructuralChange =
	| { op: 'noop' }
	| { op: 'insert'; at: number; count: number }
	| { op: 'delete'; at: number; count: number }
	| {
			op: 'replace';
			at: number;
			count: number;
			newCount: number;
			/** new-item index → old-item index: these new positions inherit old IDs/refs. */
			idMap?: Record<number, number>;
	  };

/**
 * Replace [at, at+count) where the FIRST new item inherits the old first item's id + ref,
 * preserving Svelte keyed identity (cursor, IME composition) across the swap.
 */
export function replacePreservingFirst(
	at: number,
	count: number,
	newCount: number
): StructuralChange {
	return { op: 'replace', at, count, newCount, idMap: { 0: 0 } };
}

/**
 * Stamp the nodes a change's insert/replace window CREATED as owned by the live tree;
 * pre-existing nodes go through `unshare.ts` instead. Also backfills `childIds` on
 * containers in a created subtree, before the commit publishes: a freshly-parsed node
 * carries none, and under a reused component instance the nested keyed `{#each}` renders
 * before the re-init effect, so undefined keys would reach Svelte.
 */
export function stampStructuralChange(
	children: CstNode[],
	change: StructuralChange,
	sharing: SharingState
): void {
	if (change.op !== 'insert' && change.op !== 'replace') return;
	const count = change.op === 'insert' ? change.count : change.newCount;
	for (let i = change.at; i < change.at + count; i++) {
		sharing.stamp(children[i]);
		assignChildIdsDeep(children[i]);
	}
}

/**
 * Re-shape the parallel ids/refs arrays to match the mutated children. Inserts get fresh
 * IDs + undefined refs; `idMap` on replace preserves specified old-index IDs.
 */
export function applyStructuralChangeToIdsRefs(
	change: StructuralChange,
	ids: string[],
	refs: (BlockComponent | undefined)[]
): void {
	switch (change.op) {
		case 'noop':
			return;
		case 'insert': {
			const newIds = Array.from({ length: change.count }, generateBlockId);
			const newRefs = new Array<BlockComponent | undefined>(change.count).fill(undefined);
			ids.splice(change.at, 0, ...newIds);
			refs.splice(change.at, 0, ...newRefs);
			return;
		}
		case 'delete': {
			ids.splice(change.at, change.count);
			refs.splice(change.at, change.count);
			return;
		}
		case 'replace': {
			const oldIds = ids.slice(change.at, change.at + change.count);
			const oldRefs = refs.slice(change.at, change.at + change.count);
			const idMap = change.idMap ?? {};
			const newIds = Array.from({ length: change.newCount }, (_, i) =>
				idMap[i] !== undefined ? oldIds[idMap[i]] : generateBlockId()
			);
			const newRefs = Array.from({ length: change.newCount }, (_, i) =>
				idMap[i] !== undefined ? oldRefs[idMap[i]] : undefined
			);
			ids.splice(change.at, change.count, ...newIds);
			refs.splice(change.at, change.count, ...newRefs);
			return;
		}
	}
}

/**
 * The change descriptor a tree op returns; the commit consumes it to keep the parallel
 * `blockIds` / `blockRefs` arrays in step, so callers never splice them by hand. Every variant
 * describes one contiguous `at`/`count` window: an op editing two disjoint ranges splits into
 * separate commits or uses the multi-scope commit.
 */

import type { BlockComponent } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { SharingState } from './sharing';
import { generateBlockId, assignChildIdsDeep, assignIds } from '../block-id';
import { spliceMany } from './splice-many';
import { assertInvariant } from '../assert';
import { checkStructuralDescriptor } from '../invariants/structural-descriptor';

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
 * Replace [at, at+count) where the first new item inherits the old first item's id and ref,
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
 * Mark the nodes a change's insert/replace window created as owned by the live tree (existing
 * nodes go through `unshare.ts`), and give every container in them `childIds`: a freshly parsed
 * node has none, and a reused component's nested keyed `{#each}` renders before its re-init.
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
	assertInvariant('structural-descriptor', () => checkStructuralDescriptor(change, ids.length));
	switch (change.op) {
		case 'noop':
			return;
		case 'insert': {
			const newIds = Array.from({ length: change.count }, generateBlockId);
			const newRefs = new Array<BlockComponent | undefined>(change.count).fill(undefined);
			spliceMany(ids, change.at, 0, newIds);
			spliceMany(refs, change.at, 0, newRefs);
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
			spliceMany(ids, change.at, change.count, newIds);
			spliceMany(refs, change.at, change.count, newRefs);
			return;
		}
	}
}

// ── A descriptor read off the id array ──

/** A parent whose parallel id array the splice functions maintain: a container, or the root. */
type IdCarrier = { children?: CstNode[]; childIds?: string[] };

/**
 * Borrow `parent.childIds` as the record the splice functions write their net effect into, so a
 * caller running several of them reports what they add up to instead of re-deriving it from
 * lengths (a merge during the fix-up moves positions the caller's own window never named).
 */
export function trackChildIds(parent: IdCarrier): {
	read: () => StructuralChange;
	release: () => void;
} {
	const had = parent.childIds;
	const ids = had ?? assignIds(parent.children ?? []);
	parent.childIds = ids;
	const before = [...ids];
	return {
		read: () => changeBetweenIds(before, parent.childIds ?? []),
		// A parent that kept no array keeps none: nothing else reconciles one it never had.
		release: () => {
			if (had === undefined) parent.childIds = undefined;
		}
	};
}

/**
 * The one contiguous change carrying `before` to `after`, read off slot identity: the matching
 * ends fall outside the window, and every marker surviving inside it maps to where it stood.
 */
export function changeBetweenIds(
	before: readonly string[],
	after: readonly string[]
): StructuralChange {
	const max = Math.min(before.length, after.length);
	let at = 0;
	while (at < max && before[at] === after[at]) at++;
	let tail = 0;
	while (tail < max - at && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
		tail++;
	}
	const count = before.length - at - tail;
	const newCount = after.length - at - tail;
	if (count === 0 && newCount === 0) return { op: 'noop' };
	if (count === 0) return { op: 'insert', at, count: newCount };
	if (newCount === 0) return { op: 'delete', at, count };

	const oldSlotOf = new Map<string, number>();
	for (let i = 0; i < count; i++) oldSlotOf.set(before[at + i], i);
	const idMap: Record<number, number> = {};
	for (let i = 0; i < newCount; i++) {
		const oldSlot = oldSlotOf.get(after[at + i]);
		if (oldSlot !== undefined) idMap[i] = oldSlot;
	}
	return { op: 'replace', at, count, newCount, idMap };
}

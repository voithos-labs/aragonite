/**
 * Structural-change descriptor returned by tree ops. The commit primitive
 * consumes it to auto-sync the parallel `blockIds` / `blockRefs` arrays so
 * callers never hand-splice them.
 *
 * `idMap` on `replace` lets callers preserve IDs for specific new-position
 * indices — e.g., split's first half inherits the original ID.
 */

import type { BlockComponent } from '../block-component';
import { generateBlockId } from './block-id';

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
 * Re-shape the parallel ids/refs arrays to match the mutated children.
 * Inserts get fresh IDs + undefined refs; `idMap` on replace preserves
 * specified old-index IDs for split/merge semantics.
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

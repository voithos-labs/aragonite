/**
 * Structural-change descriptor returned by tree ops. The commit primitive
 * consumes it to auto-sync the parallel `blockIds` / `blockRefs` arrays so
 * callers never hand-splice them.
 *
 * `idMap` on `replace` lets callers preserve IDs for specific new-position
 * indices — e.g., split's first half inherits the original ID.
 */

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

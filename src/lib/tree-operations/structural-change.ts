/**
 * Structural-change descriptor returned by tree ops (split, merge, delete,
 * insert, replace). The commit primitive consumes the descriptor to
 * auto-sync the parallel `blockIds` and `blockRefs` arrays — callers never
 * hand-splice those two.
 *
 * The descriptor's `at` / `count` / `newCount` fields describe the mutation
 * in terms of the children array that the op operates on (per 0.5.5.1). The
 * commit primitive applies the same shape to ids and refs.
 *
 * `idMap` on the `replace` variant lets callers preserve IDs for specific
 * new-position indices (e.g., split's first half inherits the original ID;
 * merge's survivor inherits the prev/current block's ID).
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
			/**
			 * Optional map from new-item index (0..newCount-1) to old-item index
			 * (0..count-1). Specified new-item positions inherit the old IDs/refs
			 * instead of getting fresh ones. Used by split (new[0] inherits old[0])
			 * and merge (new[0] inherits old[0] — prev or current block's id).
			 */
			idMap?: Record<number, number>;
	  };

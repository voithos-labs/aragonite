/**
 * The generation counter `unshare.ts` reads to decide whether a node must be copied before it
 * is written. Undo bumps the counter at every snapshot and restore, after which any node marked
 * earlier counts as shared. A missing `ownerEpoch` counts as shared too: an unnecessary copy is
 * correct, a missed one corrupts history.
 */
export interface SharingState {
	/** Bump after every snapshot push and every undo/redo restore. */
	markSnapshotTaken(): void;
	isShared(node: { ownerEpoch?: number }): boolean;
	/** Mark a freshly created or copied node as owned by the live tree. */
	stamp(node: { ownerEpoch?: number }): void;
}

export function createSharingState(): SharingState {
	let epoch = 0;
	return {
		markSnapshotTaken() {
			epoch++;
		},
		isShared(node) {
			return epoch > 0 && (node.ownerEpoch ?? -1) < epoch;
		},
		stamp(node) {
			node.ownerEpoch = epoch;
		}
	};
}

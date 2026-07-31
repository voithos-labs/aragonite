/**
 * Structural-sharing epoch primitive — the copy-on-write engine `unshare.ts` reads to
 * decide when a node must be cloned before it is written. The undo lifecycle bumps the
 * epoch, after which any node stamped earlier counts as shared. A missing `ownerEpoch`
 * counts as shared too: an unnecessary copy is correct, a missed one corrupts history.
 */
export interface SharingState {
	/** Bump after every snapshot push and every undo/redo restore. */
	markSnapshotTaken(): void;
	isShared(node: { ownerEpoch?: number }): boolean;
	/** Stamp a freshly created/copied node as owned by the live tree. */
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

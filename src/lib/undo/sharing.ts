/**
 * Epoch-based sharing tracker for structural-sharing undo. A snapshot push
 * (or restore) bumps the epoch; any node whose ownerEpoch predates it is
 * referenced by some stack entry and must be copied before it is written
 * (see tree-operations/unshare.ts). Missing ownerEpoch counts as shared —
 * the safe direction: an unnecessary copy is correct, a missed one corrupts
 * history. Per-editor instance, threaded through EditorActionsDeps.
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

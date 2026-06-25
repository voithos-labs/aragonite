/**
 * Structural-sharing epoch primitive — the copy-on-write engine for the CST.
 * `isShared` lets the mutation layers (chiefly unshare.ts) decide when a node
 * must be cloned before it is written, so undo snapshots that still reference
 * it stay intact. The epoch is advanced by the undo lifecycle: a snapshot push
 * or restore calls `markSnapshotTaken` on the per-editor instance threaded
 * through EditorActionsDeps, after which any node whose ownerEpoch predates the
 * bump counts as shared. Missing ownerEpoch counts as shared too — the safe
 * direction, since an unnecessary copy is correct but a missed one corrupts
 * history.
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

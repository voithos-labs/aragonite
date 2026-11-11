/**
 * The generation counter `unshare.ts` reads to decide whether a node must be copied before it
 * is written. Undo bumps the counter at every snapshot and restore, after which any node marked
 * earlier counts as shared. A missing `ownerEpoch` counts as shared too: an unnecessary copy is
 * correct, a missed one corrupts history. A node that is not shared is written where it stands,
 * so a write that may yet be rolled back hears of each one first (`watchOwned`).
 */
import type { CstNode } from '../core/nodes';

export interface SharingState {
	/** Bump after every snapshot push and every undo/redo restore. */
	markSnapshotTaken(): void;
	/** Asked before every write to a node the tree holds: false is the leave to write it where it
	 *  stands, which `watchOwned` hears first. */
	isShared(node: { ownerEpoch?: number }): boolean;
	/** Mark a freshly created or copied node as owned by the live tree. */
	stamp(node: { ownerEpoch?: number }): void;
	/** Calls `keep` with each node `isShared` clears for a write, once and before the write, until
	 *  the returned function is called. A node stamped meanwhile is new, and is left out. */
	watchOwned(keep: (node: CstNode) => void): () => void;
}

interface Watch {
	seen: Set<object>;
	keep(node: CstNode): void;
}

export function createSharingState(): SharingState {
	let epoch = 0;
	const watches = new Set<Watch>();
	return {
		markSnapshotTaken() {
			epoch++;
		},
		isShared(node) {
			const shared = epoch > 0 && (node.ownerEpoch ?? -1) < epoch;
			if (!shared && watches.size > 0) {
				for (const watch of watches) {
					if (watch.seen.has(node)) continue;
					watch.seen.add(node);
					watch.keep(node as CstNode);
				}
			}
			return shared;
		},
		stamp(node) {
			node.ownerEpoch = epoch;
			for (const watch of watches) watch.seen.add(node);
		},
		watchOwned(keep) {
			const watch: Watch = { seen: new Set(), keep };
			watches.add(watch);
			return () => void watches.delete(watch);
		}
	};
}

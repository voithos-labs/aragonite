/**
 * Epoch-based sharing tracker for structural-sharing undo. A snapshot push
 * (or restore) bumps the epoch; any node whose ownerEpoch predates it is
 * referenced by some stack entry and must be copied before it is written
 * (see tree-operations/unshare.ts). Missing ownerEpoch counts as shared —
 * the safe direction: an unnecessary copy is correct, a missed one corrupts
 * history. Per-editor instance, threaded through EditorActionsDeps.
 */
import type { Document } from '../core/nodes';

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

/**
 * DEV integrity digest for shared snapshots: FNV-1a over prefix/suffix plus
 * each top-level child's leadingTrivia + raw. Top-level only — a container's
 * raw already covers its whole subtree's bytes, so a write through any shared
 * descendant that matters to serialization surfaces here without recursion.
 */
export function digestDoc(doc: Document): number {
	let hash = 0x811c9dc5;
	const mix = (s: string): void => {
		hash = Math.imul(hash ^ s.length, 0x01000193);
		for (let i = 0; i < s.length; i++) {
			hash = Math.imul(hash ^ s.charCodeAt(i), 0x01000193);
		}
	};
	mix(doc.prefix);
	for (const child of doc.children) {
		mix(child.leadingTrivia);
		mix(child.raw);
	}
	mix(doc.suffix);
	return hash >>> 0;
}

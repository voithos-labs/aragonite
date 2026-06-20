/**
 * G1.9 — snapshot aliasing rule for structural-sharing undo. The invariant is
 * BYTES-scoped: no mutation may change the serialized bytes reachable through
 * a node an undo/redo entry still shares. One deliberate exemption:
 *
 *   - a still-shared node may be MOVED (re-parented) by the live tree (e.g.
 *     list indent) — shared means read-only BYTES, not frozen position. Each
 *     snapshot owns its children array, so its view of the tree is unaffected.
 *
 * The inline tree is a derived cache held in an external WeakMap (inline-cache),
 * not a node field, so it never reaches history bytes — nothing to exempt.
 *
 * The digest IS the formalization: FNV-1a over prefix/suffix plus each
 * top-level child's leadingTrivia + raw. Top-level only — a container's raw
 * covers its whole subtree's bytes, so a write through any shared descendant
 * that matters to serialization surfaces without recursion.
 */
import type { Document } from '../core/nodes';
import type { InvariantViolation } from './assert';

/** Structural slice of UndoEntry — keeps this leaf module free of undo/ imports. */
export interface SnapshotEntry {
	snapshot: Document;
	/** Digest of `snapshot` at push; absent outside DEV. */
	integrity?: number;
}

export function checkSnapshotIntegrity(entry: SnapshotEntry): InvariantViolation | null {
	if (entry.integrity === undefined || digestDoc(entry.snapshot) === entry.integrity) return null;
	return {
		code: 'snapshot-integrity',
		message: 'snapshot digest mismatch — a mutation wrote through a shared node'
	};
}

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

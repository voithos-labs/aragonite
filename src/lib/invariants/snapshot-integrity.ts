/**
 * G1.9: no mutation may change the serialized bytes reachable through a node an undo entry still
 * shares. It is about the bytes, not identity, so a shared node may still be moved: each snapshot
 * owns its own children array. The digest covers the top-level children only, because a
 * container's raw covers its whole subtree, so a write through any shared descendant that changes
 * the serialization shows up without recursing.
 */
import type { Document } from '../core/nodes';
import type { InvariantViolation } from '../assert';

/** The part of an undo entry this check needs, so the file imports nothing from `undo/`. */
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

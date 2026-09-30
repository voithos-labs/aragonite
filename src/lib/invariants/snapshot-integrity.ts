/**
 * G1.9: no mutation may change the serialized bytes reachable through a node an undo entry still
 * shares. It is about bytes, not identity, so a shared node may move: each snapshot owns its
 * children array. The digest covers top-level children only, since a container's raw covers its
 * whole subtree.
 */
import type { Document } from '../core/nodes';
import type { NodeView } from '../core/node-views';
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
		message: 'snapshot digest mismatch: a mutation wrote through a shared node'
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

/** G1.51: the bytes of each child an undo entry shares, null for an owned one, read before a
 *  container rebuild that may write its children's bytes (a table's rows). */
export function sharedChildBytes(
	node: NodeView,
	isShared: (child: NodeView) => boolean
): (string | null)[] {
	return (node.children ?? []).map((child) => (isShared(child) ? child.raw : null));
}

export function checkSharedChildrenKept(
	node: NodeView,
	before: readonly (string | null)[]
): InvariantViolation | null {
	const children = node.children ?? [];
	const written = before.findIndex((raw, i) => raw !== null && children[i]?.raw !== raw);
	if (written < 0) return null;
	return {
		code: 'shared-child-write',
		message: `${node.kind} rebuild wrote child ${written}, which an undo entry shares`
	};
}

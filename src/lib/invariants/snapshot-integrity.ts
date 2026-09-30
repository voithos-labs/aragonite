/**
 * G1.9: no mutation may change the serialized bytes reachable through a node an undo entry still
 * shares. It is about bytes, not identity, so a shared node may move: each snapshot owns its
 * children array. The digest covers every node, since a rebuild after a restore reads each child's
 * own bytes (a table row's padding, a quote's paragraph), not only the top-level raw.
 */
import type { CstNode, Document } from '../core/nodes';
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
	const stack: CstNode[] = [];
	for (let i = doc.children.length - 1; i >= 0; i--) stack.push(doc.children[i]);
	while (stack.length > 0) {
		const node = stack.pop()!;
		mix(node.leadingTrivia);
		mix(node.raw);
		mix(node.innerPrefix ?? '');
		mix(node.innerSuffix ?? '');
		const children = node.children;
		if (children) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
	}
	mix(doc.suffix);
	return hash >>> 0;
}

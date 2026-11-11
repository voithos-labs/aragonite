/**
 * What a rolled-back write puts back on the nodes it may have written, so the restored tree
 * serializes as it did before the write. `saveBytes` saves the bytes of nodes a write names up
 * front, and what a rebuild re-reads from them. `saveFields` saves every field of a node the write
 * owns, and `keepOwnedNodes` the blocks and ids in its lists too, for each node the write goes on
 * to change where it stands.
 */

import type { CstNode } from '../../core/nodes';
import { dropChildSpans } from '../../schema/child-spans';
import { cloneMetadata } from '../../tree-operations/clone';
import type { SharingState } from '../../tree-operations/sharing';
import { spliceMany } from '../../tree-operations/splice-many';

export function saveBytes(nodes: readonly CstNode[]): () => void {
	const saved = nodes.map((node) => ({
		node,
		raw: node.raw,
		metadata: node.metadata,
		markerWidths: node.markerWidths
	}));
	return () => {
		for (const { node, raw, metadata, markerWidths } of saved) {
			node.raw = raw;
			node.metadata = metadata;
			if (node.markerWidths !== markerWidths) node.markerWidths = markerWidths;
			dropChildSpans(node);
		}
	};
}

/** Every field `node` holds, put back by the returned function. Its lists go back as the arrays
 *  they were, holding whatever blocks they hold by then. */
export function saveFields(node: CstNode): () => void {
	const fields: Record<string, unknown> = { ...node };
	const restoreMetadataFields = saveMetadataFields(node);
	return () => {
		const now = node as unknown as Record<string, unknown>;
		for (const key of Object.keys(now)) if (!(key in fields)) delete now[key];
		for (const [key, value] of Object.entries(fields)) if (now[key] !== value) now[key] = value;
		restoreMetadataFields();
		dropChildSpans(node);
	};
}

export interface OwnedNodes {
	/** Runs `write`, keeping each node it may change where it stands as the node was when the
	 *  write first asked about it. */
	during<T>(write: () => T): T;
	/** Puts every kept node back, the last one kept first. */
	restore(): void;
}

/** The nodes a write changes where they stand rather than copying, which the array a rollback
 *  puts back still holds: a commit that joins its undo entry writes the entry's own copies. */
export function keepOwnedNodes(sharing: SharingState): OwnedNodes {
	const kept: (() => void)[] = [];
	return {
		during(write) {
			const done = sharing.watchOwned((node) => kept.push(saveNode(node)));
			try {
				return write();
			} finally {
				done();
			}
		},
		restore() {
			while (kept.length > 0) kept.pop()!();
		}
	};
}

/** `saveFields`, and the blocks and ids in the node's lists. */
function saveNode(node: CstNode): () => void {
	const restoreFields = saveFields(node);
	const children = node.children?.slice();
	const childIds = node.childIds?.slice();
	return () => {
		restoreFields();
		if (children) spliceMany(node.children!, 0, node.children!.length, children);
		if (childIds) spliceMany(node.childIds!, 0, node.childIds!.length, childIds);
	};
}

/** What `node`'s metadata holds, put back into that same object: a save of the object alone
 *  holds whatever a write has since made of it. */
function saveMetadataFields(node: CstNode): () => void {
	const metadata = node.metadata as Record<string, unknown> | undefined;
	if (!metadata) return () => {};
	const held = cloneMetadata(node.metadata!) as unknown as Record<string, unknown>;
	return () => {
		for (const key of Object.keys(metadata)) if (!(key in held)) delete metadata[key];
		Object.assign(metadata, held);
	};
}

/**
 * What a rolled-back write puts back on the nodes it may have written, so the restored tree
 * serializes as it did before the write. `saveBytes` saves the bytes of nodes a write names up
 * front, and what a rebuild re-reads from them. `keepOwnedNodes` saves everything a node holds,
 * for each node the write goes on to change where it stands.
 */

import type { CstNode } from '../../core/nodes';
import { dropChildSpans } from '../../schema/child-spans';
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

export interface OwnedNodes {
	/** Runs `write`, keeping each node it writes where it stands as the node was before. */
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

/** Every field `node` holds and the blocks and ids in its lists, put back by the returned function. */
function saveNode(node: CstNode): () => void {
	const fields: Record<string, unknown> = { ...node };
	const children = node.children?.slice();
	const childIds = node.childIds?.slice();
	return () => {
		const now = node as unknown as Record<string, unknown>;
		for (const key of Object.keys(now)) if (!(key in fields)) delete now[key];
		for (const [key, value] of Object.entries(fields)) if (now[key] !== value) now[key] = value;
		if (children) spliceMany(node.children!, 0, node.children!.length, children);
		if (childIds) spliceMany(node.childIds!, 0, node.childIds!.length, childIds);
		dropChildSpans(node);
	};
}

/**
 * What a rolled-back write puts back on each node it may have written: the bytes, and what a
 * rebuild re-reads from them, so the restored tree serializes as it did before the write.
 */

import type { CstNode } from '../../core/nodes';
import { dropChildSpans } from '../../schema/child-spans';

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

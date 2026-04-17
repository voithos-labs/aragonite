/**
 * Deep-clone helpers for documents and CST nodes (used by undo snapshots).
 */

import type { CstNode, Document } from '../core/nodes';

// ── Document ────────────────────────────────────────────────────────────────

export function cloneDocument(doc: Document): Document {
	return {
		kind: 'document',
		prefix: doc.prefix,
		children: doc.children.map(cloneNode),
		suffix: doc.suffix
	};
}

// ── Node ────────────────────────────────────────────────────────────────────

export function cloneNode(node: CstNode): CstNode {
	const cloned: CstNode = {
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw
	};

	if (node.metadata) {
		cloned.metadata = { ...node.metadata };
	}

	if (node.children) {
		cloned.innerPrefix = node.innerPrefix;
		cloned.children = node.children.map(cloneNode);
		cloned.innerSuffix = node.innerSuffix;
	}

	return cloned;
}

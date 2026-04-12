/**
 * Document cloning and block ID management for the editor.
 */

import type { CstNode, Document } from './core/nodes';

// ── Serialization ───────────────────────────────────────────────────────────

// Re-export serialize so callers can use `serializeMutable` without
// importing from core/serializer directly.
export { serialize as serializeMutable } from './core/serializer';

// ── Cloning ─────────────────────────────────────────────────────────────────

export function cloneDocument(doc: Document): Document {
	return {
		kind: 'document',
		prefix: doc.prefix,
		children: doc.children.map(cloneNode),
		suffix: doc.suffix
	};
}

function cloneNode(node: CstNode): CstNode {
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

// ── Block IDs ───────────────────────────────────────────────────────────────

export function generateBlockId(): string {
	return crypto.randomUUID();
}

export function assignIds(children: CstNode[]): string[] {
	return children.map(() => generateBlockId());
}

// Re-export text helpers so editor code can import from one place.
export { displayLength, trimTrailingLineEnding } from './core/text-utils';

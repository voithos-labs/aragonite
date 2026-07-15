import type { CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { assertInvariant } from '../invariants/assert';
import { checkCloneSafeMetadata } from '../invariants/node-shape';

// ── Document ────────────────────────────────────────────────────────────────

// A deep clone of a view is a fully owned mutable tree — the clone door (core/node-views.ts).
export function cloneDocument(doc: DocumentView): Document {
	return {
		kind: 'document',
		prefix: doc.prefix,
		children: doc.children.map(cloneNode),
		suffix: doc.suffix
	};
}

// ── Node ────────────────────────────────────────────────────────────────────

export function cloneNode(node: NodeView): CstNode {
	const cloned: CstNode = {
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw
	};

	if (node.metadata) {
		assertInvariant('clone-safe-metadata', () => checkCloneSafeMetadata(node));
		cloned.metadata = cloneMetadata(node.metadata);
	}

	if (node.children) {
		cloned.innerPrefix = node.innerPrefix;
		cloned.children = node.children.map(cloneNode);
		cloned.innerSuffix = node.innerSuffix;
		if (node.childIds) cloned.childIds = [...node.childIds];
	}

	return cloned;
}

// Snapshot must not share mutable references (arrays) with the live tree —
// otherwise an in-place splice on the live tree's metadata would also mutate
// the snapshot. Metadata is one level deep across all kinds today: primitives,
// strings, and at most one array (TableMetadata.alignments).
export function cloneMetadata(
	meta: NonNullable<NodeView['metadata']>
): NonNullable<CstNode['metadata']> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(meta)) {
		out[k] = Array.isArray(v) ? [...v] : v;
	}
	return out as unknown as NonNullable<CstNode['metadata']>;
}

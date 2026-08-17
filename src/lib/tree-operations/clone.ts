import type { CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { assertInvariant } from '../assert';
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
	// `kind` is a runtime value spanning every arm, so no literal arm matches —
	// the cast is the generic-clone door, mirroring copyNode's spread (unshare.ts).
	const cloned = {
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw
	} as CstNode;

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

// Snapshots must share no mutable reference with the live tree, or an in-place splice on
// live metadata reaches the snapshot. One level deep suffices — G1.6 forbids deeper.
export function cloneMetadata(
	meta: NonNullable<NodeView['metadata']>
): NonNullable<CstNode['metadata']> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(meta)) {
		out[k] = Array.isArray(v) ? [...v] : v;
	}
	return out as unknown as NonNullable<CstNode['metadata']>;
}

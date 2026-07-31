/**
 * A number that changes whenever the document's serialized bytes change, stable across a
 * flush that changed nothing. It exists because the `$state` document is mutated IN PLACE,
 * so an identity-keyed memo over it would hit forever and hand back a stale answer. Lazy —
 * the touch walk runs only when something reads the version, then once per flush however
 * many readers there are; reading it inside a `$derived` subscribes that reader to edits.
 */

import type { DocumentView, NodeView } from '../core/node-views';

/**
 * Register a reactive read on the `BytesView` set (`core/node-views.ts`) — exactly the
 * fields whose change changes `serialize(doc)`. `childIds`/`ownerEpoch` are bookkeeping
 * and deliberately untouched: they move without the bytes moving.
 */
function touchDocumentBytes(doc: DocumentView): void {
	void doc.prefix;
	void doc.suffix;
	touchChildren(doc.children);
}

function touchChildren(children: readonly NodeView[]): void {
	for (const node of children) {
		void node.kind;
		void node.leadingTrivia;
		void node.raw;
		void node.innerPrefix;
		void node.innerSuffix;
		// Into arrays, not just at them: a table's `alignments` is written per element in
		// place (`tree-operations/table-mutations.ts`), moving the delimiter row's bytes.
		// `cloneMetadata` states the one-level-deep shape this relies on.
		if (node.metadata) {
			for (const value of Object.values(node.metadata)) {
				if (Array.isArray(value)) for (const item of value) void item;
			}
		}
		if (node.children) touchChildren(node.children);
	}
}

export function createContentVersion(getDoc: () => DocumentView): () => number {
	// Bumped inside the derived: it recomputes exactly when a touched byte moved, so
	// "recomputed" IS the version change. A plain counter — only the derived is subscribed to.
	let version = 0;
	const current = $derived.by(() => {
		touchDocumentBytes(getDoc());
		return ++version;
	});
	return () => current;
}

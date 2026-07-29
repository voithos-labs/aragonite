/**
 * The editor's content version: a number that changes whenever the document's
 * serialized bytes change, and is stable across a flush that changed nothing.
 *
 * It exists because the `$state` document is mutated IN PLACE — its object
 * identity survives every edit — so nothing derived from the document can be
 * memoized on the document itself. A consumer that walks the tree (footnote
 * numbering, a table of contents, any cross-block derivation) otherwise re-walks
 * once per reader per flush, and an identity-keyed memo would hit forever and
 * hand back a stale answer.
 *
 * The version is a lazy `$derived`, so a document with no reader pays nothing:
 * the touch walk below runs only when something reads the version, and then once
 * per flush no matter how many readers there are. Reading it inside a reader's
 * own `$derived` is what subscribes that reader to edits anywhere.
 */

import type { DocumentView, NodeView } from '../core/node-views';

/**
 * Register a reactive read on every byte-carrying field of the tree — the
 * `BytesView` set (`core/node-views.ts`), which is exactly the fields a change to
 * which changes `serialize(doc)`. `childIds`/`ownerEpoch` are bookkeeping and
 * deliberately untouched: they move without the bytes moving.
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
		// Into arrays, not just at them: a table's `alignments` is written per element
		// in place (tree-operations/table-mutations.ts), and that moves the delimiter
		// row's bytes. `cloneMetadata` states the one-level-deep shape this relies on.
		if (node.metadata) {
			for (const value of Object.values(node.metadata)) {
				if (Array.isArray(value)) for (const item of value) void item;
			}
		}
		if (node.children) touchChildren(node.children);
	}
}

export function createContentVersion(getDoc: () => DocumentView): () => number {
	// Bumped from inside the derived on purpose: the derived recomputes exactly
	// when a touched byte moved, so "recomputed" IS the version change. A plain
	// counter (not `$state`) — nothing subscribes to it, only to the derived.
	let version = 0;
	const current = $derived.by(() => {
		touchDocumentBytes(getDoc());
		return ++version;
	});
	return () => current;
}

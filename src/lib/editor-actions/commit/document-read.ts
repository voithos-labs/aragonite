/**
 * One editor's read of its document for plugins: the block at a document byte, and the block view
 * of a node it renders. Lazy: nothing is measured until a plugin reads a position, and the byte
 * layout is built once per version of the document.
 */
import type { DocumentView, NodeView } from '../../core/node-views';
import type { AnyBlockKind } from '../../core/nodes';
import { resolvedInlineContent, type InlineReading } from '../../core/inline/inline-cache';
import { documentByteMap, type DocumentByteMap } from '../../tree-operations/container-offsets';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { pathOfNode } from './change-record';
import { blockOf, type Block, type BlockReading } from '../../schema/doc-view';
import type { BlockType } from '../../schema/plugin-unit';

export interface DocumentRead {
	/** The deepest block holding document byte `at`: a byte of a marker or a container's own line
	 *  goes to the text on its line, as the caret does. Null outside the document. */
	blockAt(at: number): Block | null;
	/** The block view of `node`, last seen at `path`. */
	blockOf(node: NodeView, path: readonly number[]): Block;
}

export function createDocumentRead(deps: {
	getDoc(): DocumentView;
	/** Bumped on every change to the document's bytes. */
	version(): number;
	typeOf(kind: AnyBlockKind): BlockType<unknown>;
	reading: InlineReading;
}): DocumentRead {
	let held: { version: number; map: DocumentByteMap; length: number } | null = null;

	function layout(): { map: DocumentByteMap; length: number } {
		const version = deps.version();
		if (held?.version !== version) {
			const doc = deps.getDoc();
			let length = doc.prefix.length + doc.suffix.length;
			for (const top of doc.children) length += top.leadingTrivia.length + top.raw.length;
			held = { version, map: documentByteMap(doc), length };
		}
		return held;
	}

	const reading: BlockReading = {
		typeOf: deps.typeOf,
		place(node, path) {
			const doc = deps.getDoc();
			const at = path && blockNodeAt(doc, path) === node ? path : pathOfNode(doc, node);
			if (!at) return null;
			const { map } = layout();
			return (offset) => map.byteOf(at, offset);
		},
		inline: (node) => resolvedInlineContent(node, deps.reading)
	};

	return {
		blockAt(at) {
			const { map, length } = layout();
			if (!Number.isInteger(at) || at < 0 || at > length) return null;
			const leaf = map.leafAt(at);
			const node = leaf && blockNodeAt(deps.getDoc(), leaf.path);
			return node ? blockOf(node, reading, leaf.path) : null;
		},
		blockOf: (node, path) => blockOf(node, reading, path)
	};
}

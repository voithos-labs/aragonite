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
import type { EditorSelection } from '../../selection/primitives';

export interface DocumentRead {
	/** The deepest block holding document byte `at`: a byte of a marker or a container's own line
	 *  goes to the text on its line, as the caret does. Null outside the document. */
	blockAt(at: number): Block | null;
	/** The block view of `node`, last seen at `path`. */
	blockOf(node: NodeView, path: readonly number[]): Block;
	/** `selection` in document bytes, `from` first; null for none or a cell selection. */
	rangeOf(selection: EditorSelection | null): { from: number; to: number } | null;
	/** The path of the deepest block holding byte `at` of a range already in the document. */
	pathAt(at: number): number[] | null;
}

export function createDocumentRead(deps: {
	getDoc(): DocumentView;
	/** Bumped on every change to the document's bytes. */
	version(): number;
	typeOf(kind: AnyBlockKind): BlockType<unknown>;
	reading: InlineReading;
}): DocumentRead {
	let held: Layout | null = null;

	function layout(): Layout {
		const version = deps.version();
		if (held?.version !== version) held = { version, map: documentByteMap(deps.getDoc()) };
		return held;
	}

	// Summed for `blockAt` alone, since it walks every top-level block and a paint never needs it.
	function lengthOf(laid: Layout): number {
		if (laid.length === undefined) {
			const doc = deps.getDoc();
			let length = doc.prefix.length + doc.suffix.length;
			for (const top of doc.children) length += top.leadingTrivia.length + top.raw.length;
			laid.length = length;
		}
		return laid.length;
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
			const laid = layout();
			if (!Number.isInteger(at) || at < 0 || at > lengthOf(laid)) return null;
			const leaf = laid.map.leafAt(at);
			const node = leaf && blockNodeAt(deps.getDoc(), leaf.path);
			return node ? blockOf(node, reading, leaf.path) : null;
		},
		blockOf: (node, path) => blockOf(node, reading, path),
		rangeOf(selection) {
			if (!selection || selection.anchor.cellCoordinate || selection.focus.cellCoordinate)
				return null;
			const { map } = layout();
			const a = map.byteOf(selection.anchor.path, selection.anchor.offset);
			const f = map.byteOf(selection.focus.path, selection.focus.offset);
			return a === null || f === null ? null : { from: Math.min(a, f), to: Math.max(a, f) };
		},
		pathAt: (at) => layout().map.leafAt(at)?.path ?? null
	};
}

interface Layout {
	version: number;
	map: DocumentByteMap;
	length?: number;
}

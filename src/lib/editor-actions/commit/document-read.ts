/**
 * One editor's read of its document for plugins: the block at a document byte, and the block view
 * of a node it renders. Lazy: nothing is measured until a plugin reads a position, and the byte
 * map is built once per write, over the starts the editor keeps.
 */
import type { DocumentView, NodeView } from '../../core/node-views';
import type { AnyBlockKind } from '../../core/nodes';
import { resolvedInlineContent, type InlineReading } from '../../core/inline/inline-cache';
import { documentByteMap, type DocumentByteMap } from '../../tree-operations/container-offsets';
import type { Measured } from '../../tree-operations/top-level-starts';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { pathOfNode } from './change-record';
import { blockOf, type Block, type BlockReading } from '../../schema/doc-view';
import type { BlockType } from '../../schema/plugin-unit';
import type { EditorSelection } from '../../selection/primitives';

export interface DocumentRead {
	/** The deepest block holding document byte `at`: a byte of a marker or a container's own line
	 *  goes to the text on its line, as the caret does. Null outside the document. */
	blockAt(at: number): Block | null;
	/** The block view of `node`, last seen at `path`, or found where no path is given. */
	blockOf(node: NodeView, path?: readonly number[]): Block;
	/** `selection` in document bytes, `from` first; null for none or a cell selection. */
	rangeOf(selection: EditorSelection | null): { from: number; to: number } | null;
	/** The path of the deepest block holding byte `at` of a range already in the document. */
	pathAt(at: number): number[] | null;
}

export function createDocumentRead(deps: {
	getDoc(): DocumentView;
	/** That document with the starts the editor keeps for it, a new pair after every write. */
	measured(): Measured;
	typeOf(kind: AnyBlockKind): BlockType<unknown>;
	reading: InlineReading;
}): DocumentRead {
	let held: Layout | null = null;

	function layout(): Layout {
		const of = deps.measured();
		if (held?.of !== of) held = { of, map: documentByteMap(of) };
		return held;
	}

	/** Where `node` is now: `path` while it still holds the node, else a search. */
	function find(node: NodeView, path: readonly number[] | undefined): readonly number[] | null {
		const doc = deps.getDoc();
		return path && blockNodeAt(doc, path) === node ? path : pathOfNode(doc, node);
	}

	const reading: BlockReading = {
		typeOf: deps.typeOf,
		place(node, path) {
			const at = find(node, path);
			if (!at) return null;
			const { map } = layout();
			return (offset) => map.byteOf(at, offset);
		},
		end(node, path) {
			const at = find(node, path);
			return at && layout().map.ownEnd(at);
		},
		inline: (node) => resolvedInlineContent(node, deps.reading)
	};

	return {
		blockAt(at) {
			const laid = layout();
			if (!Number.isInteger(at) || at < 0 || at > laid.of.starts.length) return null;
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
	of: Measured;
	map: DocumentByteMap;
}
